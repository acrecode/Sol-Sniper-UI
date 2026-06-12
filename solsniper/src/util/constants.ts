/**
 * Program IDs and well-known accounts.
 * NOTE (instructions.md §11): confirm these against Helius/Solscan at build
 * time — Solana programs get redeployed and IDs change.
 */
export const PROGRAM_IDS = {
  /** pump.fun bonding-curve program */
  PUMPFUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  /** PumpSwap AMM (graduation target since 2025/2026) */
  PUMPSWAP: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  /** Raydium AMM v4 (legacy graduation + native pools) */
  RAYDIUM_AMM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  /** Raydium CPMM */
  RAYDIUM_CPMM: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
} as const;

/** legacy pump.fun → Raydium migration account */
export const PUMP_RAYDIUM_MIGRATION =
  '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';

/** Addresses excluded from holder-concentration math. */
export const KNOWN_NON_HOLDER_ADDRESSES = new Set<string>([
  '11111111111111111111111111111111', // system program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL token program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  PUMP_RAYDIUM_MIGRATION,
]);

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Jito tip accounts (rotate; pick one at random per bundle). Confirm at build time. */
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghULedkt',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLubp9R',
  'ADuUkR4vqLUMWXxW9gh6D6L8pGmD1S2NkR8Y3kFNwgkM',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];
