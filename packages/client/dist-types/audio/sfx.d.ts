type SfxName = 'shot' | 'hit' | 'explosion' | 'bigExplosion' | 'pickup' | 'stageClear' | 'gameOver' | 'brick' | 'spawn' | 'freeze' | 'click';
/** WebAudio-synthesised sound effects. Unlocked on the first user gesture; respects the sound setting. */
declare class Sfx {
    private ctx;
    private master;
    private noise;
    private lastPlayed;
    private unlocked;
    constructor();
    private ensure;
    unlock(): Promise<void>;
    private get enabled();
    private tone;
    private burst;
    play(name: SfxName): void;
}
export declare const sfx: Sfx;
export {};
//# sourceMappingURL=sfx.d.ts.map