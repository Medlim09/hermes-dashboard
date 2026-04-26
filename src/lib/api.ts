export async function getHealth() {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    const res = await fetch(`${base}/health`);
    return res.json();
  } catch {
    return { status: "CRITICAL", issues: [{ type: "Backend unreachable", severity: "CRITICAL", description: "Cannot reach http://localhost:3001", suggestion: "Start server.js" }] };
  }
}

export async function sendMessage(message: string) {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  const res = await fetch(`${base}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  return res.json();
}

export async function getStatus() {
  return {
    state: "running",
    lastAction: "Analyzing BTC",
  };
}

export async function getLogs() {
  return [
    {
      id: "1",
      message: "BTC BUY signal detected",
    },
  ];
}
