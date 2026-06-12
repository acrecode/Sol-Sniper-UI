import { z } from 'zod';

/* ───────────────────────── Environment ───────────────────────── */

export const ModeEnum = z.enum(['dry-run', 'devnet', 'live']);
export type Mode = z.infer<typeof ModeEnum>;

export const EnvSchema = z
  .object({
    SOLANA_RPC_URL: z.string().url().optional(),
    SOLANA_WS_URL: z.string().optional(),
    HELIUS_API_KEY: z.string().optional(),
    YELLOWSTONE_GRPC_URL: z.string().optional(),
    YELLOWSTONE_GRPC_TOKEN: z.string().optional(),
    JITO_BLOCK_ENGINE_URL: z.string().optional(),
    WALLET_PRIVATE_KEY: z.string().optional(),
    MODE: ModeEnum.default('dry-run'),
    CONFIRM_LIVE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    DB_PATH: z.string().default('./data/sniper.db'),
    API_PORT: z.coerce.number().int().positive().default(8787),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error'])
      .default('info'),
    LOG_PRETTY: z
      .string()
      .optional()
      .transform((v) => v !== 'false'),
  })
  .superRefine((env, ctx) => {
    if (env.MODE === 'live' && !env.CONFIRM_LIVE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'MODE=live requires CONFIRM_LIVE=true. Refusing to deploy real capital without explicit confirmation.',
        path: ['CONFIRM_LIVE'],
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/* ───────────────────────── Strategy config ─────────────────────────
 * Field names intentionally mirror the UI control panel (SolSniper.jsx)
 * so PUT /config round-trips with no translation layer.
 * See instructions.md §6 for the filter reference. */

export const SourceEnum = z.enum([
  'pumpfun_curve',
  'pumpswap_pool',
  'raydium_pool',
]);
export type Source = z.infer<typeof SourceEnum>;

export const PhaseEnum = z.enum([
  'new_mint',
  'mid_curve',
  'at_grad',
  'post_grad',
]);
export type Phase = z.infer<typeof PhaseEnum>;

export const TokenProgramPolicyEnum = z.enum(['spl_only', 'allow_t22']);
export const FeeModeEnum = z.enum(['auto', 'fixed']);

export const StrategySchema = z.object({
  /* 6.1 source & discovery */
  sources: z.array(SourceEnum).default(['pumpswap_pool']),
  phases: z.array(PhaseEnum).default(['at_grad', 'post_grad']),
  curveMin: z.number().min(0).max(100).default(0),
  curveMax: z.number().min(0).max(100).default(100),
  whitelist: z.string().default(''), // newline/space separated addresses
  blacklist: z.string().default(''),
  copyTrade: z.string().default(''),

  /* 6.2 safety / rug gates */
  reqMintRevoked: z.boolean().default(true),
  reqFreezeRevoked: z.boolean().default(true),
  reqUpdateRevoked: z.boolean().default(false),
  tokenProgram: TokenProgramPolicyEnum.default('spl_only'),
  reqLpBurned: z.boolean().default(true),
  maxDevPct: z.number().min(0).max(100).default(5),
  maxTop10Pct: z.number().min(0).max(100).default(30),
  maxSinglePct: z.number().min(0).max(100).default(15),
  maxBundlePct: z.number().min(0).max(100).default(20),
  minHolders: z.number().min(0).default(25),
  minLiqUsd: z.number().min(0).default(8000),
  reqHoneypotSim: z.boolean().default(true),
  maxBuyTax: z.number().min(0).max(100).default(0),
  maxSellTax: z.number().min(0).max(100).default(0),
  maxRugScore: z.number().min(0).max(100).default(35),

  /* 6.3 social / metadata */
  reqSocial: z.boolean().default(false),
  keywordBlock: z.string().default(''),
  rejectDup: z.boolean().default(true),

  /* 6.4 sizing & execution */
  solPerToken: z.number().min(0).default(0.25),
  maxSlippage: z.number().min(0).max(100).default(12),
  feeMode: FeeModeEnum.default('auto'),
  feeAggr: z.number().min(1).max(6).default(2),
  jito: z.boolean().default(true),
  maxConcurrent: z.number().int().min(0).default(5),
  dailyCapSol: z.number().min(0).default(2),

  /* 6.5 exit management */
  tpLadder: z.string().default('100:50, 400:25'), // "gain%:sell%, ..."
  stopLoss: z.number().min(0).max(100).default(35),
  trailing: z.number().min(0).max(100).default(0), // 0 = off
  maxHoldMin: z.number().min(0).default(30),
  liqDropExit: z.number().min(0).max(100).default(40),
  breakeven: z.boolean().default(true),
  aggrTP: z.boolean().default(true),
  aggrTrigger: z.number().min(0).default(40),
  aggrSellPct: z.number().min(0).max(100).default(80),
  fastExit: z.boolean().default(true),
});

export type StrategyConfig = z.infer<typeof StrategySchema>;

export const DEFAULT_STRATEGY: StrategyConfig = StrategySchema.parse({});
