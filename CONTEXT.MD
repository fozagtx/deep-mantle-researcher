# Context

Branium is a Mantle Sepolia claim duel app. The UI reads and writes against the deployed Branium contract; the frontend must not invent claim data or transaction hashes.

## Live Contract

- Network: Mantle Sepolia
- Chain ID: 5003
- Native currency: MNT
- Contract: `0x86506fd629941d1a53a27eb081fe5dbcc183e972`
- Deploy block: `39988589`
- Explorer: https://sepolia.mantlescan.xyz/address/0x86506fd629941d1a53a27eb081fe5dbcc183e972

## Runtime Rules

- Contract state is the source of truth.
- Claim creation requires a connected wallet and a real contract write.
- Resolution is handled by the oracle path after deadline; users do not manually resolve claims.
- OpenRouter configuration uses only `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`.
- Agent workers sign real Mantle transactions from server-only private-key env vars:
  `ORACLE_PRIVATE_KEY`, `MARKET_CREATOR_PRIVATE_KEY`, and `PANEL_<NAME>_PRIVATE_KEY`.

## Verification Commands

```bash
npm run compile:contract
npx tsc --noEmit
npm run test:smoke
npm run build
```
