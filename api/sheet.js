export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyulP43RWyq8kkpDudVtGPyZLZZgNStaswZMIlKd-49SUoMWOAJjITbwMPwfQtaFgXy/exec";

  try {
    let response;
    if (req.method === "GET") {
      const action = req.query.action || "read";
      response = await fetch(`${SCRIPT_URL}?action=${action}`, { redirect: "follow" });
    } else {
      const body = req.body;
      const params = new URLSearchParams();
      params.append("action", body.action);
      Object.keys(body).forEach(k => { if (k !== "action") params.append(k, body[k]); });
      response = await fetch(`${SCRIPT_URL}?${params.toString()}`, { redirect: "follow" });
    }
    const text = await response.text();
    try {
      res.status(200).json(JSON.parse(text));
    } catch {
      res.status(200).send(text);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
