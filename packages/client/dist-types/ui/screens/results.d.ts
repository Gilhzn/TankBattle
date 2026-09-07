import { type MatchResult } from '@tank/shared';
export interface ResultsInfo {
    mode: 'solo' | 'coop' | 'versus';
    won: boolean;
    score: number;
    kills: number;
    stage: number;
    coins: number;
    xp: number;
    /** false when the server could not verify / we are offline */
    verified: boolean | null;
    unsynced: boolean;
    results?: MatchResult[];
    myId?: string;
    onPlayAgain: () => void;
    onMenu: () => void;
    playAgainLabel?: string;
}
/** Full-screen results overlay appended to `container`. Returns a dispose function. */
export declare function showResults(container: HTMLElement, info: ResultsInfo): () => void;
//# sourceMappingURL=results.d.ts.map