// Cloudflare Worker: وسيط يبعت إشعارات OneSignal من غير ما المفتاح السري يظهر في التطبيق.
// المتغيرات المطلوبة (Settings > Variables):
//   ONESIGNAL_APP_ID   (نص عادي)
//   ONESIGNAL_API_KEY  (Secret)
//   GYM_CODE           (نفس "كود الجيم" في التطبيق)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json({ ok: true, service: "gym-push" });
    if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY || !env.GYM_CODE) return json({ error: "worker not configured" }, 500);

    let b;
    try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }
    if (!b || b.gym !== env.GYM_CODE) return json({ error: "forbidden" }, 403);

    const title = String(b.title || "").slice(0, 80);
    const body = String(b.body || "").slice(0, 200);
    if (!title && !body) return json({ error: "empty message" }, 400);

    const payload = {
      app_id: env.ONESIGNAL_APP_ID,
      headings: { en: title || " " },
      contents: { en: body || " " },
    };

    if (b.type === "to") {
      const ids = Array.isArray(b.to) ? b.to.filter((x) => typeof x === "string" && ID_RE.test(x)).slice(0, 5) : [];
      if (!ids.length) return json({ error: "no targets" }, 400);
      payload.include_aliases = { external_id: ids };
      payload.target_channel = "push";
    } else if (b.type === "room") {
      if (b.room !== "kickbox" && b.room !== "champs") return json({ error: "bad room" }, 400);
      const f = [{ field: "tag", key: "room_" + b.room, relation: "=", value: "1" }];
      if (typeof b.exclude === "string" && ID_RE.test(b.exclude)) {
        f.push({ operator: "AND" }, { field: "tag", key: "uid", relation: "!=", value: b.exclude });
      }
      payload.filters = f;
    } else if (b.type === "all") {
      payload.included_segments = ["Subscribed Users"];
    } else {
      return json({ error: "bad type" }, 400);
    }

    if (typeof b.url === "string" && b.url.length < 400 && /^https:\/\//.test(b.url)) payload.url = b.url;
    if (typeof b.tag === "string" && ID_RE.test(b.tag)) payload.web_push_topic = b.tag.slice(0, 32);
    if (b.call) { payload.priority = 10; payload.ttl = 60; } else { payload.ttl = 86400; }

    const key = String(env.ONESIGNAL_API_KEY);
    const r = await fetch("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: (key.startsWith("os_v2_") ? "Key " : "Basic ") + key,
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
  },
};
