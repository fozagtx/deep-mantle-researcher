export function rememberPrivateInviteKey(vsId: number, inviteKey: string) {
  void vsId;
  void inviteKey;
}

export function getStoredPrivateInviteKey(vsId: number) {
  void vsId;
  return "";
}

export function generatePrivateInviteKey() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}
