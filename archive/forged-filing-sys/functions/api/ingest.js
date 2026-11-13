// Pages Function: /api/ingest — stream a site/catalog page into F0.
//
// Governance (docs/FORGED_FILE_STANDARD.md):
// - This endpoint is the INTERCEPT/STREAM lane: it fetches a public URL and
//   extracts governable text; the browser then forges it through F0→F3.
// - It never executes fetched content; extraction is text-only.
// - Inventory & order lane: the response carries extracted items so the
//   curator can forge/lock them from the curation stack.
export async function onRequestPost(context) {
  const { request } = context;
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request", reason: "invalid JSON body" }, 400);
  }
  const raw = typeof body?.url === "string" ? body.url.trim() : "";
  let target;
  try {
    target = new URL(raw);
  } catch {
    return json({ error: "bad_request", reason: "url required" }, 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return json({ error: "bad_request", reason: "http(s) URLs only" }, 400);
  }

  try {
    const res = await fetch(target.toString(), {
      headers: {
        "user-agent": "AVA007-AgentBrowser/1.0 (+https://ai.ingeniosity.tech)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return json({ error: "fetch_failed", reason: "origin returned " + res.status }, 502);
    }
    const ctype = res.headers.get("content-type") || "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ctype)) {
      return json({ error: "unsupported", reason: "not an html/text page: " + ctype }, 415);
    }
    const html = await res.text();

    // --- extraction (text-only, no evaluation) -------------------------------
    const title =
      (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || target.hostname)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    // Inventory & order: itemize headings/products/links as discrete entries.
    const items = [];
    const headingRe = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
    let mh;
    while ((mh = headingRe.exec(html)) && items.length < 24) {
      const t = mh[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t.length >= 3) items.push({ kind: "heading", text: t.slice(0, 160) });
    }
    const linkRe = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((mh = linkRe.exec(html)) && items.length < 48) {
      const t = (mh[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t.length >= 3) items.push({ kind: "link", text: t.slice(0, 160), href: mh[1].slice(0, 500) });
    }

    return json({
      title,
      bytes: text.length,
      chunks: Math.max(1, Math.ceil(text.length / 900)),
      excerpt: text.slice(0, 1200),
      items,
      source_url: target.toString(),
    });
  } catch (err) {
    return json(
      { error: "fetch_failed", reason: String(err && err.message ? err.message : err) },
      502
    );
  }
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
  });
}
