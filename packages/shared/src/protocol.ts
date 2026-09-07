import { z } from 'zod';
import type { VersusFormat } from './types.js';

export const PROTOCOL_VERSION = 1;

const dirSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(-1)]);
const modeSchema = z.enum(['coop', 'versus']);
export const difficultySchema = z.enum(['easy', 'normal', 'hard']);
export const versusFormatSchema = z.enum(['ffa', 'teams']);
const codeSchema = z.string().regex(/^[A-Z2-9]{5}$/);
export const nicknameSchema = z.string().trim().min(2).max(16).regex(/^[\p{L}\p{N} _.-]+$/u);
export const skuSchema = z.string().regex(/^[a-z0-9_]{2,40}$/);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().min(10).max(2048), version: z.number().int() }),
  z.object({
    type: z.literal('createRoom'),
    mode: modeSchema,
    isPrivate: z.boolean().default(false),
    loadout: z.array(skuSchema).max(6).default([]),
    difficulty: difficultySchema.default('normal'),
    versusFormat: versusFormatSchema.default('ffa'),
  }),
  z.object({ type: z.literal('joinRoom'), code: codeSchema, loadout: z.array(skuSchema).max(6).default([]) }),
  z.object({ type: z.literal('quickPlay'), mode: modeSchema, loadout: z.array(skuSchema).max(6).default([]), versusFormat: versusFormatSchema.default('ffa') }),
  z.object({ type: z.literal('leaveRoom') }),
  z.object({ type: z.literal('setReady'), ready: z.boolean() }),
  z.object({ type: z.literal('setLoadout'), loadout: z.array(skuSchema).max(6) }),
  z.object({ type: z.literal('startGame') }),
  z.object({ type: z.literal('input'), seq: z.number().int().nonnegative(), dir: dirSchema, fire: z.boolean() }),
  z.object({ type: z.literal('useItem'), sku: skuSchema, nonce: z.string().min(1).max(64) }),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(140) }),
  z.object({ type: z.literal('ping'), t: z.number() }),
  z.object({ type: z.literal('resume'), roomId: z.string().max(64), resumeToken: z.string().max(128) }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface RoomPlayerInfo {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  loadout: string[];
  skin: string;
  isHost: boolean;
  /** Side in a versus lobby: own slot in free-for-all, 0 or 1 in 2v2. -1 in co-op. */
  team: number;
}

export type RoomStatus = 'lobby' | 'countdown' | 'playing' | 'stageClear' | 'gameOver';

export interface RoomStateMessage {
  type: 'roomState';
  roomId: string;
  code: string;
  mode: 'coop' | 'versus';
  versusFormat: VersusFormat;
  isPrivate: boolean;
  status: RoomStatus;
  hostId: string;
  players: RoomPlayerInfo[];
  countdownEndsAt?: number;
  resumeToken?: string;
}

export interface MatchResult {
  playerId: string;
  name: string;
  slot: number;
  score: number;
  kills: number;
  deaths: number;
  team: number;
  stageReached: number;
  coins: number;
  xp: number;
  won: boolean;
}

export type ServerMessage =
  | { type: 'welcome'; playerId: string; name: string; serverTime: number; tickRate: number; snapshotRate: number }
  | RoomStateMessage
  | { type: 'matchFound'; roomId: string }
  | { type: 'gameStart'; seed: number; stage: number; snapshot: unknown; yourSlot: number }
  | { type: 'snapshot'; snapshot: unknown }
  | { type: 'stageClear'; stage: number; scores: Array<{ playerId: string; score: number }>; coinsEarned: number }
  | { type: 'gameOver'; reason: string; results: MatchResult[] }
  | { type: 'itemResult'; nonce: string; ok: boolean; error?: string; inventory?: Record<string, number> }
  | { type: 'walletUpdate'; coins: number; gems: number }
  | { type: 'chat'; from: string; name: string; text: string }
  | { type: 'pong'; t: number; serverTick: number; serverTime: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'kicked'; reason: string }
  | { type: 'left' };

export const guestAuthSchema = z.object({
  deviceToken: z.string().min(8).max(128).optional(),
  nickname: nicknameSchema.optional(),
});
export const patchMeSchema = z.object({ nickname: nicknameSchema.optional(), skin: skuSchema.optional(), settings: z.record(z.string(), z.unknown()).optional() });
export const purchaseSchema = z.object({ sku: skuSchema, qty: z.number().int().min(1).max(20).default(1), currency: z.enum(['coins', 'gems']) });
export const checkoutSchema = z.object({ sku: skuSchema });
export const mockCompleteSchema = z.object({ orderId: z.string().min(1).max(64) });
export const equipSchema = z.object({ sku: skuSchema });
export const giftSendSchema = z
  .object({ to: z.string().trim().min(2).max(40), sku: skuSchema, qty: z.number().int().min(1).max(5000).default(1), message: z.string().trim().max(120).optional() })
  .refine((g) => (g.sku === 'gems' ? g.qty <= 5000 : g.qty <= 10), { message: 'qty too large for this item', path: ['qty'] });
export const battlepassClaimSchema = z.object({ tier: z.number().int().min(1).max(60), track: z.enum(['free', 'premium']) });
export const adCompleteSchema = z.object({ adSessionId: z.string().min(1).max(64), placement: z.enum(['results', 'menu']).default('menu') });
export const soloStartSchema = z.object({
  loadout: z.array(skuSchema).max(6).default([]),
  stage: z.number().int().min(1).max(999).default(1),
  difficulty: difficultySchema.default('normal'),
});
export const boostEffectSchema = z.enum(['grenade', 'clock', 'shield', 'life', 'star', 'revive']);
export const soloResultSchema = z.object({
  soloId: z.string().min(1).max(64),
  inputs: z.array(z.array(z.tuple([dirSchema, z.number().int().min(0).max(1)]))).max(30 * 60 * 60),
  /** [tick, effect] pairs for boosts the server pre-authorised at solo start. */
  commands: z.array(z.tuple([z.number().int().min(1), boostEffectSchema])).max(20).default([]),
  claimedScore: z.number().int().nonnegative(),
  claimedStage: z.number().int().min(1),
});
export type BoostEffect = z.infer<typeof boostEffectSchema>;
