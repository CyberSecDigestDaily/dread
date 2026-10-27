"""Browser end-to-end test: guest use, sign-up with a (virtual) passkey, import, sync, sign-out/in, shared lists between two
people, public profiles, plus screenshots. Run against `wrangler dev`: python tests/e2e.py [base_url] [shots_dir]"""
import asyncio, json, os, re, sys, time
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp/shots"
os.makedirs(SHOTS, exist_ok=True)
UNIQ = str(int(time.time()))[-5:]
results = []


def check(cond, name, extra=""):
    results.append((bool(cond), name))
    print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond or not extra else f" — {str(extra)[:300]}"))


async def person(browser, name, mobile=False, scheme="dark"):
    ctx = await browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 900},
                                    color_scheme=scheme, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
    page = await ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    cdp = await ctx.new_cdp_session(page)
    await cdp.send("WebAuthn.enable")
    auth = await cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {
        "protocol": "ctap2", "transport": "internal", "hasResidentKey": True, "hasUserVerification": True,
        "isUserVerified": True, "automaticPresenceSimulation": True}})
    return {"name": name, "ctx": ctx, "page": page, "errors": errors, "cdp": cdp, "auth": auth["authenticatorId"]}


async def shot(p, name, full=False):
    await p["page"].screenshot(path=f"{SHOTS}/{name}.png", full_page=full)


async def wait_toast(page, pattern, timeout=8000):
    await page.wait_for_function("re => { const t = document.getElementById('toastText'); return t && new RegExp(re).test(t.textContent) && !document.getElementById('toast').hidden; }", arg=pattern, timeout=timeout)


async def first_rows(page, n=2):
    return await page.eval_on_selector_all("#listFor .film", f"els => els.slice(0, {n}).map(e => e.dataset.id)")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        don = await person(browser, "don")
        pg = don["page"]

        print("\nGuest")
        await pg.goto(BASE + "/#for")
        await pg.wait_for_selector("#listFor .film")
        check(await pg.locator("#acctBtn").inner_text() == "Sign in", "header offers Sign in")
        ids = await first_rows(pg, 3)
        check(len(ids) == 3, "For you lists films", ids)
        # Rate the first film 8, want the second, pass the third.
        row = pg.locator(f'#listFor .film[data-id="{ids[0]}"]')
        await row.locator('[data-act="seen"]').click()
        await row.locator('[data-act="rate"][data-rate="8"]').click()
        await pg.locator(f'#listFor .film[data-id="{ids[1]}"] [data-act="want"]').click()
        await pg.locator(f'#listFor .film[data-id="{ids[2]}"] [data-act="pass"]').click()
        guest = await pg.evaluate("JSON.parse(localStorage.getItem('dread.state.v1'))")
        check(guest and guest["films"][ids[0]]["s"] == 8 and guest["films"][ids[1]].get("w") == 1 and guest["films"][ids[2]].get("x") == 1, "guest ratings saved in the browser")
        await pg.wait_for_selector("#syncNote:not([hidden])")
        check("only" in (await pg.locator("#syncNote").inner_text()), "banner suggests an account")
        await shot(don, "01-guest-for-you")

        print("\nSign up with a passkey")
        await pg.locator("#acctBtn").click()
        await pg.wait_for_selector("#authDlg[open] #fCreate")
        await shot(don, "02-auth-dialog")
        await pg.fill("#aHandle", "ab")
        await pg.click("#fCreate button[type=submit]")
        check(await pg.locator("#aErr").is_visible(), "short names are caught before the passkey prompt")
        handle = "don" + UNIQ
        await pg.fill("#aHandle", handle)
        await pg.click("#fCreate button[type=submit]")
        await pg.wait_for_selector("#authDlg .codes")
        codes = await pg.eval_on_selector_all("#authDlg .codes code", "els => els.map(e => e.textContent)")
        check(len(codes) == 10, "ten recovery codes shown", codes)
        await shot(don, "03-recovery-codes")
        check(await pg.locator('[data-auth="codes-done"]').is_disabled(), "can't continue until codes are saved")
        await pg.check("#aSaved")
        await pg.click('[data-auth="codes-done"]')
        await pg.wait_for_selector('[data-auth="import"]')
        txt = await pg.locator("#authBox").inner_text()
        check("1 rating" in txt and "1 film on the watchlist" in txt and "1 pass" in txt, "import offer counts this browser's list", txt)
        await shot(don, "04-import-offer")
        await pg.click('[data-auth="import"]')
        await wait_toast(pg, "Signed in as")
        check((await pg.locator("#acctBtn").inner_text()) == "@" + handle, "header shows the account")
        await pg.wait_for_function("() => document.querySelector('#syncDot').className.includes('on')", timeout=8000)
        state = await pg.evaluate("fetch('/api/state?since=0').then(r => r.json())")
        check(state["films"].get(ids[0], {}).get("s") == 8 and state["films"].get(ids[1], {}).get("w") == 1, "imported list is on the server", state)
        check(await pg.evaluate("localStorage.getItem('dread.state.v1')") is None, "guest copy cleared after import")
        cookies = await don["ctx"].cookies()
        c = next((c for c in cookies if c["name"] == "__Host-dread"), None)
        check(c and c["httpOnly"] and c["secure"] and c["sameSite"] == "Strict", "session cookie is HttpOnly, Secure, SameSite=Strict", c)
        check(await pg.evaluate("document.cookie") == "", "page script can't read the session cookie")

        print("\nSync")
        ids2 = await first_rows(pg, 1)
        row = pg.locator(f'#listFor .film[data-id="{ids2[0]}"]')
        await row.locator('[data-act="seen"]').click()
        await row.locator('[data-act="rate"][data-rate="10"]').click()
        await pg.wait_for_function("id => fetch('/api/state?since=0').then(r => r.json()).then(s => s.films[id] && s.films[id].s === 10)", arg=ids2[0], timeout=8000)
        check(True, "a new rating reaches the server")

        print("\nSettings and account")
        await pg.click("#openSettings")
        await pg.wait_for_selector("#settings[open] #acctBox .sync-status")
        await pg.click('details[data-sec="keys"] > summary')
        await pg.wait_for_selector("#pkList li[data-key]")
        check(await pg.locator("#pkList li[data-key]").count() == 1, "passkey listed")
        await pg.wait_for_selector("#sessList li[data-sess]")
        check("this one" in await pg.locator("#sessList").inner_text(), "current session listed")
        await pg.click('details[data-sec="profile"] > summary')
        await pg.check("#acPublic")
        await wait_toast(pg, "public")
        await shot(don, "05-settings-account", full=True)
        await pg.click('[data-acct="link"]')
        await pg.wait_for_selector("#linkBox .bigcode code")
        link_code = await pg.locator("#linkBox .bigcode code").inner_text()
        check(re.match(r"^[0-9A-Z]{4}-[0-9A-Z]{4}$", link_code), "device link code shown", link_code)
        check(await pg.locator("#lqr svg").count() == 1, "with a QR code")
        await pg.click("#closeSettings")

        print("\nSign in another device with the code")
        tv = await person(browser, "tv", mobile=True, scheme="light")
        await tv["page"].goto(BASE + "/#link=" + link_code.replace("-", ""))
        await tv["page"].wait_for_selector("#authDlg[open] #fLink")
        check((await tv["page"].input_value("#lCode")) == link_code.replace("-", ""), "the QR link opens sign-in with the code filled in")
        await tv["page"].click("#fLink button[type=submit]")
        await tv["page"].wait_for_selector('[data-auth="addkey"]')
        await tv["page"].click('[data-auth="addkey-skip"]')
        await wait_toast(tv["page"], "Signed in as")
        await tv["page"].wait_for_selector("#listFor .film")
        n_rated = await tv["page"].locator("#nRated").inner_text()
        check(n_rated == "2", "the new device has the same list", n_rated)
        await shot(tv, "06-mobile-light-signed-in")

        print("\nSign out and back in")
        await pg.click("#openSettings")
        await pg.click('[data-acct="signout"]')
        await wait_toast(pg, "Signed out")
        check((await pg.locator("#acctBtn").inner_text()) == "Sign in", "signed out")
        check(await pg.evaluate("localStorage.getItem('dread.acct.v1')") is None, "account copy removed from the browser")
        check((await pg.locator("#nRated").inner_text()) == "", "guest view is empty")
        await pg.click("#acctBtn")
        await pg.click('[data-auth="signin"]')
        await wait_toast(pg, "Signed in as")
        await pg.wait_for_function("() => document.getElementById('nRated').textContent === '2'", timeout=8000)
        check(True, "passkey sign-in brings the list back")

        print("\nShared list")
        await pg.goto(BASE + "/#together")
        await pg.wait_for_selector("#fNewList")
        await pg.fill("#nlName", "Horror night")
        await pg.click("#fNewList button[type=submit]")
        await pg.wait_for_selector("#tgInvite code")
        invite = await pg.locator("#tgInvite code").inner_text()
        check("#join=" in invite, "list created with an invite link", invite)
        await pg.locator('#view-together [data-tg="add"]').first.click()
        await wait_toast(pg, "Added")
        check(await pg.locator('#view-together [data-tg="watched"]').count() == 1, "a pick added to the list")
        await shot(don, "07-together-list", full=True)

        pho = await person(browser, "phoebe", scheme="light")
        pp = pho["page"]
        await pp.goto(invite)
        await pp.wait_for_selector("#syncNote:not([hidden])")
        check("invited" in await pp.locator("#syncNote").inner_text(), "invitee is asked to sign in")
        await pp.click('#syncNote [data-note="auth"]')
        await pp.fill("#aHandle", "phoebe" + UNIQ)
        await pp.click("#fCreate button[type=submit]")
        await pp.wait_for_selector("#aSaved")
        await pp.check("#aSaved")
        await pp.click('[data-auth="codes-done"]')
        await pp.wait_for_selector("#view-together .tg-title h2", timeout=10000)
        check((await pp.locator("#view-together .tg-title h2").inner_text()) == "Horror night", "invitee lands on the list after joining")
        members = await pp.locator("#view-together .members").inner_text()
        check("@" + handle in members, "both people listed", members)
        mems = await pp.eval_on_selector_all("#view-together .film .mem", "els => els.length")
        check(mems > 0, "rows show each person's match")
        await shot(pho, "08-together-invitee", full=True)

        print("\nPublic profile")
        await pp.goto(f"{BASE}/u/{handle}")
        await pp.wait_for_selector("#view-profile .tg-intro h2")
        check(handle in await pp.locator("#view-profile h2").inner_text(), "profile page loads")
        await pp.click('[data-tg="pf"][data-v="all"]')
        await pp.wait_for_selector("#view-profile .film .badge.theirs")
        check(await pp.locator("#view-profile .film").count() == 2, "shows their two ratings")
        await shot(pho, "09-profile", full=True)
        prow = pp.locator("#view-profile .film").first
        await prow.locator('[data-act="want"]').click()
        await wait_toast(pp, "watchlist")
        check(True, "can add their film to your own watchlist")
        await pp.click('.tabs a[data-view="want"]')
        await pp.wait_for_selector("#listWant .film")
        check(pp.url.endswith("/#want"), "tabs leave the profile without a reload", pp.url)

        print("\nPrivate again")
        await pg.click("#openSettings")
        await pg.evaluate("document.querySelector('details[data-sec=profile]').open = true")
        await pg.uncheck("#acPublic")
        await wait_toast(pg, "private")
        r = await pp.evaluate(f"fetch('/api/u/{handle}').then(r => r.status)")
        check(r == 404, "a private profile is gone", r)
        await pg.click("#closeSettings")

        print("\nMobile and theme screenshots")
        await shot(pho, "10-watchlist-light")
        m = await person(browser, "mobile", mobile=True)
        await m["page"].goto(BASE + "/#for")
        await m["page"].wait_for_selector("#listFor .film")
        await shot(m, "11-mobile-dark-guest")
        await m["page"].click("#acctBtn")
        await m["page"].wait_for_selector("#authDlg[open]")
        await shot(m, "12-mobile-auth")
        await m["page"].goto(BASE + "/privacy")
        await shot(m, "13-privacy", full=True)

        print("\nConsole")
        for p in (don, tv, pho, m):
            errs = [e for e in p["errors"] if "favicon" not in e and "Failed to load resource" not in e]
            check(not errs, f"no console errors for {p['name']}", errs)
        await browser.close()
    bad = [n for ok, n in results if not ok]
    print(f"\n{len(results) - len(bad)} passed, {len(bad)} failed")
    sys.exit(1 if bad else 0)

asyncio.run(main())
