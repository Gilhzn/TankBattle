export interface AdResult {
    ok: boolean;
    coins: number;
    error?: string;
}
export interface AdProvider {
    /** Shows a rewarded ad for `placement`; resolves with the server-credited coins. */
    show(placement: 'results' | 'menu'): Promise<AdResult>;
}
/**
 * Mock rewarded-ad provider: asks the server for an ad session, shows a full-screen countdown
 * (min seconds enforced server-side) and completes the session for the reward.
 */
export declare class MockAdProvider implements AdProvider {
    show(placement: 'results' | 'menu'): Promise<AdResult>;
    private playCountdown;
}
export declare const ads: AdProvider;
//# sourceMappingURL=ads.d.ts.map