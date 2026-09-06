import type { WorkshopData, WorkshopSlide } from './types';
export function allowedIndex(slides: WorkshopSlide[], passed: Set<number>, requested: number, preview: boolean): number;
export function mountWorkshop(root: ShadowRoot, host: HTMLElement, data: WorkshopData, hooks: {
  preview: boolean;
  doneLabel?: string;
  back: () => void;
  done: () => void;
  native: (slide: WorkshopSlide | null, target: HTMLElement | null) => void;
}): { pass: (slide: WorkshopSlide) => void; destroy: () => void };
