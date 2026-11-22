return function(t)
    local matching = require("matching")
    local json = require("json")

    local fixture = json.decode(t.read_file(t.root .. "/tests/fixtures/algolia-elden-ring.json"))
    local hits = fixture.hits
    local elden_ring = hits[1]
    local shadow_edition = hits[2]

    local matcher = matching.new({})

    local function make_hit(overrides)
        local hit = {
            prod_id = 1,
            objectID = "1",
            name = "Test Game",
            fullname = "Test Game - PC (Steam)",
            platform = "Steam",
            region = "Worldwide",
            is_draft = 0,
            has_stock = 1,
            preorder = 0,
            is_dlc = 0,
            updated_at = 1,
            country_whitelist = nil,
            country_blacklist = nil,
        }
        for key, value in pairs(overrides or {}) do
            hit[key] = value
        end
        return hit
    end

    local function select(name, candidate_hits, country, appid)
        return matcher:select({ appid = appid or 1, name = name }, candidate_hits, country or "DE")
    end

    t.test("matching: normalization lowercases, strips trademarks, punctuation and platform tags", function()
        t.assert_eq(matcher:normalize("Elden Ring™ - PC (Steam)"), "elden ring")
        t.assert_eq(matcher:normalize("Pokémon®: Legends & Adventures!"), "pokemon legends and adventures")
        t.assert_eq(matcher:normalize("Assassin’s Creed®"), "assassin s creed")
        t.assert_eq(matcher:normalize("Half-Life 2: Episode One"), "half life 2 episode one")
        t.assert_eq(matcher:normalize("Game - PC (Steam) Global Key"), "game")
        t.assert_eq(matcher:normalize("SteamWorld Dig"), "steamworld dig")
    end)

    t.test("matching: splits known and unknown edition suffixes", function()
        local base, edition = matching.split_title("Elden Ring Deluxe Edition")
        t.assert_eq(base, "elden ring")
        t.assert_eq(edition, "deluxe")

        base, edition = matching.split_title("The Witcher 3 Wild Hunt - Game of the Year Edition")
        t.assert_eq(base, "the witcher 3 wild hunt")
        t.assert_eq(edition, "goty")

        base, edition = matching.split_title("Elden Ring Shadow of the Erdtree Edition")
        t.assert_eq(base, "elden ring shadow of the erdtree")
        t.assert_eq(edition, "other:shadow of the erdtree")

        base, edition = matching.split_title("Elden Ring Standard Edition")
        t.assert_eq(base, "elden ring")
        t.assert_eq(edition, "standard")

        base, edition = matching.split_title("Elden Ring")
        t.assert_eq(base, "elden ring")
        t.assert_nil(edition)
    end)

    t.test("matching: requires platform Steam", function()
        local eligible, reason = matcher:eligible(make_hit({ platform = "Epic Games" }), "DE")
        t.assert_false(eligible)
        t.assert_eq(reason, "platform")

        eligible = matcher:eligible(make_hit({ platform = nil, type = "Steam" }), "DE")
        t.assert_true(eligible)
    end)

    t.test("matching: rejects drafts", function()
        local eligible, reason = matcher:eligible(make_hit({ is_draft = 1 }), "DE")
        t.assert_false(eligible)
        t.assert_eq(reason, "draft")
    end)

    t.test("matching: honors country whitelist, blacklist and region strings", function()
        t.assert_true(matcher:eligible(elden_ring, "DE"), "DE is whitelisted for the fixture product")
        t.assert_false(matcher:eligible(elden_ring, "US"), "US is not in the fixture whitelist")

        local blacklisted = make_hit({ country_blacklist = { "DE" }, region = "Europe" })
        t.assert_false(matcher:eligible(blacklisted, "DE"))

        local combined = make_hit({ region = "Europe & US & Canada" })
        t.assert_true(matcher:eligible(combined, "DE"))
        t.assert_true(matcher:eligible(combined, "US"))
        t.assert_false(matcher:eligible(combined, "JP"))

        t.assert_true(matcher:eligible(make_hit({ region = "Oceania" }), "AU"))
        t.assert_false(matcher:eligible(make_hit({ region = "Europe" }), "BR"))
        t.assert_true(matcher:eligible(make_hit({ region = "Worldwide" }), "ZZ"))
        t.assert_false(matcher:eligible(make_hit({ region = "Europe" }), "ZZ"))
    end)

    t.test("matching: exact title resolves the base product", function()
        local hit = select("Elden Ring", hits)
        t.assert_not_nil(hit)
        t.assert_eq(hit.prod_id, 4824)
    end)

    t.test("matching: exact title beats the edition bundle in the same result page", function()
        local hit = select("Elden Ring", hits)
        t.assert_eq(hit.prod_id, 4824)
    end)

    t.test("matching: a matching edition resolves the edition product", function()
        local hit = select("Elden Ring Shadow of the Erdtree Edition", hits)
        t.assert_not_nil(hit)
        t.assert_eq(hit.prod_id, 16007)
    end)

    t.test("matching: containment with a filler word is a true positive", function()
        local hit = select("Witcher 3 Wild Hunt", { make_hit({ name = "The Witcher 3 Wild Hunt" }) })
        t.assert_not_nil(hit)
    end)

    t.test("matching: diacritics and platform noise do not block a true positive", function()
        local hit = select("Pokémon Legends: Arceus", {
            make_hit({ name = "Pokemon Legends Arceus - PC (Steam)" }),
        })
        t.assert_not_nil(hit)
    end)

    t.test("matching: base game is not priced from a different edition", function()
        local hit = select("Elden Ring", { shadow_edition })
        t.assert_nil(hit)

        hit = select("Starfield", { make_hit({ name = "Starfield Premium Edition" }) })
        t.assert_nil(hit)
    end)

    t.test("matching: DLC / expansion titles are not mistaken for the base game", function()
        local hit = select("Cyberpunk 2077", { make_hit({ name = "Cyberpunk 2077 Phantom Liberty" }) })
        t.assert_nil(hit)

        hit = select("Hades", { make_hit({ name = "Hades II" }) })
        t.assert_nil(hit)
    end)

    t.test("matching: conflicting editions are rejected", function()
        local hit = select("Elden Ring Deluxe Edition", {
            make_hit({ name = "Elden Ring Ultimate Edition" }),
        })
        t.assert_nil(hit)

        hit = select("Elden Ring Deluxe Edition", { make_hit({ name = "Elden Ring" }) })
        t.assert_nil(hit)
    end)

    t.test("matching: prefers an in-stock copy over an identical out-of-stock one", function()
        local hit = select("Test Game", {
            make_hit({ prod_id = 1, has_stock = 0 }),
            make_hit({ prod_id = 2, has_stock = 1 }),
        })
        t.assert_not_nil(hit)
        t.assert_eq(hit.prod_id, 2)
    end)

    t.test("matching: manual override wins for the configured appid", function()
        local overridden = matching.new({ overrides = { ["42"] = 999 } })
        local hit = overridden:select(
            { appid = 42, name = "Totally Different" },
            { make_hit({ prod_id = 999, name = "Unrelated Game" }) },
            "DE"
        )
        t.assert_not_nil(hit)
        t.assert_eq(hit.prod_id, 999)
    end)

    t.test("matching: override absent from the page falls back to title matching", function()
        local overridden = matching.new({ overrides = { ["42"] = 999 } })
        local hit = overridden:select(
            { appid = 42, name = "Test Game" },
            { make_hit({ prod_id = 7, name = "Test Game" }) },
            "DE"
        )
        t.assert_not_nil(hit)
        t.assert_eq(hit.prod_id, 7)
    end)
end
