import { Store } from './store.js';
export type Lang = 'en' | 'he';
export type Handedness = 'left' | 'right';
export interface Settings {
    lang: Lang;
    handedness: Handedness;
    joystickSize: number;
    sound: boolean;
    haptics: boolean;
    reducedMotion: boolean;
    nickname: string;
    soloLoadout: string[];
    mpLoadout: string[];
}
export declare const settings: Store<Settings>;
export declare function applyDocumentSettings(s?: Settings): void;
export declare function isCoarsePointer(): boolean;
/** True when touch is a plausible primary input (coarse pointer or any touch points). */
export declare function hasTouchInput(): boolean;
//# sourceMappingURL=settings.d.ts.map