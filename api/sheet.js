export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwYQE4ALmgPj42yDxBcFlHiT0XFW6UijiRBz3DeBUmWH9k76wGl6QwH1_L-Y7XBj8Rc/exec";

  try {
    const response = await fetch(`${SCRIPT_URL}?action=read`, {
      method: "GET",
      redirect: "follow",
      headers: { "Accept": "application/json" }
    });
    const text = await response.text();
    try { res.status(200).json(JSON.parse(text)); }
    catch { res.status(200).send(text); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
