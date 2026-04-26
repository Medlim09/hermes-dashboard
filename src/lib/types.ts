export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type Signal = {
  asset: string;
  decision: "BUY" | "SELL" | "WAIT";
  confidence: number;
};

export type AgentStatus = {
  state: "idle" | "running";
  lastAction: string;
};

export type Log = {
  id: string;
  message: string;
};
