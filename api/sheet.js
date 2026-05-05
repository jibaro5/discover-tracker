export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyulP43RWyq8kkpDudVtGPyZLZZgNStaswZMIlKd-49SUoMWOAJjITbwMPwfQtaFgXy/exec";

  try {
    const params = new URLSearchParams();
    
    if (req.method === "GET") {
      params.set("action", req.query.action || "read");
    } else {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      Object.entries(body).forEach(([k, v]) => params.set(k, String(v)));
    }

    const response = await fetch(`${SCRIPT_URL}?${params.toString()}`, {
      method: "GET",
      redirect: "follow"
    });

    const text = await response.text();
    try { res.status(200).json(JSON.parse(text)); }
    catch { res.status(200).send(text); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
