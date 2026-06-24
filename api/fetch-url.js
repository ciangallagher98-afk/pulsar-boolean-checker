const https = require("https");
const http  = require("http");
const { URL } = require("url");

const JS_WALL_SIGNALS = [
  "please enable js", "please enable javascript", "enable javascript",
  "disable any ad blocker", "javascript is required", "javascript must be enabled",
  "you need to enable javascript", "this page requires javascript",
];

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    const { text, warning } = await fetchText(url);
    return res.status(200).json({ text, warning, url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function fetchText(urlStr, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error("Too many redirects"));
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch { return reject(new Error("Invalid URL")); }

    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        return fetchText(next, redirects + 1).then(resolve).catch(reject);
      }

      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { if (raw.length < 300000) raw += c; });
      res.on("end", () => {
        const rawLower = raw.toLowerCase();
        const jsWall = JS_WALL_SIGNALS.find(s => rawLower.includes(s));
        if (jsWall) {
          return resolve({
            text: "",
            warning: `This site requires JavaScript to render. The content could not be extracted — paste the article text manually instead.`,
          });
        }
        const text = extractText(raw);
        resolve({ text: text.slice(0, 80000), warning: null });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out after 15s")); });
  });
}

function extractText(html) {
  let clean = html
    .replace(/<(script|style|noscript|nav|header|footer|aside|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "");

  const articleMatch =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(clean) ||
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(clean) ||
    /<div[^>]*(?:class|id)[^>]*(?:article|content|body|post|story|press-release|entry)[^>]*>([\s\S]*?)<\/div>/i.exec(clean);

  const source = articleMatch ? articleMatch[1] : clean;

  return source
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"')
    .replace(/\s+/g, " ").trim();
}
