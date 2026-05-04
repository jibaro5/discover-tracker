export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyulP43RWyq8kkpDudVtGPyZLZZgNStaswZMIlKd-49SUoMWOAJjITbwMPwfQtaFgXy/exec";

  try {
    let url = SCRIPT_URL;
    let options = { redirect: "follow" };

    if (req.method === "GET") {
      url += `?action=${req.query.action || "read"}`;
    } else {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const params = new URLSearchParams(body);
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, options);
    const text = await response.text();
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
