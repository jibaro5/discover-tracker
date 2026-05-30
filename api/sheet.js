export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxgu19FoL21iMLj6rQPuJtq0oprfB6GCySBiVGn1N0d_O_Icahqq7WIHdX5_yzetAsj;
  try {
    const params = new URLSearchParams();

    if (req.method === "GET") {
      params.set("action", req.query.action || "read");
    } else {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      // Explicitly map every field
      params.set("action", body.action || "read");
      if (body.desc !== undefined) params.set("desc", String(body.desc));
      if (body.amount !== undefined) params.set("amount", String(body.amount));
      if (body.date !== undefined) params.set("date", String(body.date));
      if (body.category !== undefined) params.set("category", String(body.category));
      if (body.owed !== undefined) params.set("owed", String(body.owed));
      if (body.id !== undefined) params.set("id", String(body.id));
      if (body.added !== undefined) params.set("added", String(body.added));
      if (body.paid !== undefined) params.set("paid", String(body.paid));
    }

    const response = await fetch(`${SCRIPT_URL}?${params.toString()}`, {
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
