import base64, json, os, sqlite3, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4799"
OUT = sys.argv[1]
DB = sys.argv[2]
# Optional: viewport width, screenshot name prefix, and "nomobile" to skip the 375px part.
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 1440
PREFIX = sys.argv[4] if len(sys.argv) > 4 else ""
MOBILE = not (len(sys.argv) > 5 and sys.argv[5] == "nomobile")
IMG = "/home/kb26/Downloads/2499.jpg"
IMG2 = "/home/kb26/Downloads/01-affected-projects.png"
VIDEO = "/home/kb26/Downloads/bulin-47.mp4"
os.makedirs(OUT, exist_ok=True)
shots = []
def shot(page, name, **kw):
    name = PREFIX + name
    if not name.endswith(("01-drop-overlay.png", "06-lightbox.png")):
        page.evaluate("() => { const t = document.querySelector('.thread'); if (t) t.scrollTop = t.scrollHeight }")
        time.sleep(0.4)
    p = os.path.join(OUT, name)
    page.screenshot(path=p, **kw)
    shots.append(p)
    print("shot", p)

def b64(path):
    return base64.b64encode(open(path, "rb").read()).decode()

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": WIDTH, "height": 1000}, device_scale_factor=1)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    import time as _t
    _t0 = _t.time()
    page.on("request", lambda r: "bulin-47.mp4" in r.url and "Downloads" in r.url and print(f"{_t.time()-_t0:6.2f} REQ", r.headers.get("range")))
    page.on("response", lambda r: "bulin-47.mp4" in r.url and "Downloads" in r.url and print(f"{_t.time()-_t0:6.2f} RES", r.status, r.headers.get("content-range")))
    page.on("requestfailed", lambda r: "bulin-47.mp4" in r.url and "Downloads" in r.url and print(f"{_t.time()-_t0:6.2f} FAIL", r.failure))
    page.goto(BASE)
    page.wait_for_selector(".composer__attach")

    # 1. Attach an image with the file picker.
    page.set_input_files('.composer input[type=file]', IMG)

    # 2. Paste a screenshot (a real PNG of the page) into the composer.
    png = base64.b64encode(page.screenshot(clip={"x": 0, "y": 0, "width": 640, "height": 400})).decode()
    page.evaluate("""(data) => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const file = new File([bytes], 'image.png', { type: 'image/png' });
      const dt = new DataTransfer(); dt.items.add(file);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('.composer__input').dispatchEvent(ev);
    }""", png)

    # 3. Drop a video on the chat, with a slow upload so progress shows.
    cdp = ctx.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 20, "downloadThroughput": -1, "uploadThroughput": 600 * 1024})
    page.evaluate("""(data) => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      window.__drop = new DataTransfer();
      window.__drop.items.add(new File([bytes], 'bulin-47.mp4', { type: 'video/mp4' }));
      const target = document.querySelector('.page__view:not([hidden])');
      target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: window.__drop, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: window.__drop, bubbles: true, cancelable: true }));
    }""", b64(VIDEO))
    page.wait_for_selector(".dropzone")
    time.sleep(0.4)
    shot(page, "01-drop-overlay.png")
    page.evaluate("""() => {
      const target = document.querySelector('.page__view:not([hidden])');
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__drop, bubbles: true, cancelable: true }));
    }""")
    page.wait_for_selector(".tray__progress")
    time.sleep(1.5)
    shot(page, "02-tray-uploading.png", clip={"x": 0, "y": 700, "width": WIDTH, "height": 300})
    assert page.locator(".composer__send").is_disabled(), "send must wait for uploads"
    page.wait_for_function("document.querySelectorAll('.tray__progress').length === 0", timeout=60000)
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1})
    cdp.send("Network.disable")
    cdp.detach()
    assert page.locator(".tray__item").count() == 3
    page.fill(".composer__input", "Three things for you: a photo, a screenshot and a clip.")
    shot(page, "03-tray-ready.png", clip={"x": 0, "y": 700, "width": WIDTH, "height": 300})

    # Remove (x) works and deletes the upload: add a throwaway file and remove it.
    page.set_input_files('.composer input[type=file]', {"name": "notes.txt", "mimeType": "text/plain", "buffer": b"throwaway"})
    page.wait_for_function("document.querySelectorAll('.tray__item').length === 4 && !document.querySelector('.tray__progress')")
    page.click('button[aria-label="Remove notes.txt"]')
    assert page.locator(".tray__item").count() == 3

    before = page.locator(".msg--captain").count()
    page.click(".composer__send")
    page.locator(".msg--owner .media").last.wait_for()
    page.wait_for_function(f"document.querySelectorAll('.msg--captain').length > {before} && [...document.querySelectorAll('.msg--captain')].at(-1).textContent.includes('Got all 3')", timeout=15000)
    time.sleep(0.8)
    shot(page, "04-sent-with-attachments.png")

    # What the captain received: the ledger's owner entry.
    con = sqlite3.connect(DB)
    owner = con.execute("SELECT text FROM ledger WHERE kind='owner' ORDER BY id DESC LIMIT 1").fetchone()[0]
    print("CAPTAIN RECEIVED:\n" + owner)
    assert owner.count("(Web: I attached") == 3 and "a photo" in owner and "a video" in owner
    inbox = [l.split("Saved at ")[1].rstrip(")") for l in owner.splitlines() if "Saved at" in l]
    for p in inbox:
        assert os.path.isfile(p), p
    assert not any("notes" in f for f in os.listdir(os.path.dirname(inbox[0]))), "removed upload was not deleted"
    open(os.path.join(OUT, "captain-received.txt"), "w").write(owner + "\n")

    # 4. A reply naming a video and images renders them.
    RUN = f"run {int(time.time()) % 100000}"
    page.fill(".composer__input", f"show Here is the clip ({RUN}) {VIDEO} and the chart:\n\n![chart]({IMG2})\n\nAlso `~/Downloads/2499.jpg`.")
    page.click(".composer__send")
    reply = page.locator(".msg--captain", has_text=RUN)
    reply.wait_for(timeout=15000)
    v = reply.locator("video.media__video")
    v.wait_for()
    reply.locator(".md .media__image img").wait_for()
    v.scroll_into_view_if_needed()
    v.evaluate("v => { v.muted = true; return v.play() }")
    for _ in range(60):
        if v.evaluate("v => v.currentTime") > 1.2: break
        time.sleep(0.25)
    print(f"{_t.time()-_t0:6.2f} SEEKING")
    print("BEFORE SEEK", v.evaluate("v => ({ n: document.querySelectorAll('.msg--captain video.media__video').length, src: v.src, t: v.currentTime, seekable: v.seekable.length ? [v.seekable.start(0), v.seekable.end(0)] : null, buf: v.buffered.length ? v.buffered.end(v.buffered.length - 1) : null, net: v.networkState })"))
    v.evaluate("v => { v.currentTime = 9; }")
    time.sleep(0.3)
    print("JUST AFTER", v.evaluate("v => ({ t: v.currentTime, seeking: v.seeking })"))
    for _ in range(40):
        st = v.evaluate("v => ({ t: v.currentTime, paused: v.paused, ended: v.ended, seeking: v.seeking, ready: v.readyState, net: v.networkState, buf: [...Array(v.buffered.length)].map((_, i) => [+v.buffered.start(i).toFixed(2), +v.buffered.end(i).toFixed(2)]), id: v.dataset.k || (v.dataset.k = Math.random().toString(36).slice(2,6)) })")
        if st["t"] > 9.3: break
        if st["paused"]: v.evaluate("v => v.play()")
        time.sleep(0.25)
    print("AFTER SEEK", st)
    assert st["t"] > 9.3
    state = v.evaluate("v => ({ t: v.currentTime, d: v.duration, w: v.videoWidth, h: v.videoHeight, ready: v.readyState, paused: v.paused })")
    print("VIDEO", state)
    v.evaluate("v => v.pause()")
    imgs = reply.locator(".media__image img").evaluate_all("is => is.map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth }))")
    print("IMAGES", imgs)
    assert all(i["w"] > 0 for i in imgs) and len(imgs) >= 2
    time.sleep(0.5)
    shot(page, "05-reply-video-and-images.png")
    page.set_viewport_size({"width": WIDTH, "height": 2000})
    time.sleep(0.6)
    shot(page, "05b-reply-whole-message.png")
    page.set_viewport_size({"width": WIDTH, "height": 1000})

    # Full size on click.
    page.locator(".msg--captain .media__image").last.click()
    page.wait_for_selector(".lightbox img")
    time.sleep(0.4)
    shot(page, "06-lightbox.png")
    page.keyboard.press("Escape")
    assert page.locator(".lightbox").count() == 0

    # 5. History survives a reload.
    page.reload()
    page.locator(".msg--owner .media__image img").last.wait_for()
    page.locator(".msg--captain video.media__video").last.wait_for()
    time.sleep(1)
    shot(page, "07-after-reload.png")
    owner_media = page.evaluate("[...document.querySelectorAll('.msg--owner')].filter(m => m.textContent.includes('Three things')).at(-1).querySelectorAll('.media img, .media video').length")
    assert owner_media == 3, owner_media

    # Mobile.
    if not MOBILE:
        print("PAGE ERRORS", errors)
        b.close()
        print(json.dumps(shots))
        sys.exit(0)
    m = b.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mp = m.new_page()
    mp.goto(BASE)
    mp.locator(".msg--captain video.media__video").last.wait_for()
    time.sleep(1)
    mp.evaluate("document.querySelector('.thread').scrollTop = 1e9")
    time.sleep(0.5)
    shot(mp, "08-mobile-375.png")
    mp.set_input_files('.composer input[type=file]', [{"name": "2499.jpg", "mimeType": "image/jpeg", "buffer": open(IMG, "rb").read()}, {"name": "report.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 test"}])
    mp.wait_for_function("document.querySelectorAll('.tray__item').length === 2 && !document.querySelector('.tray__progress')")
    time.sleep(0.3)
    shot(mp, "09-mobile-tray.png")
    while mp.locator(".tray__remove").count():
        mp.locator(".tray__remove").first.click()

    print("PAGE ERRORS", errors)
    b.close()
print(json.dumps(shots))
