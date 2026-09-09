import { workshopDay, workshopMeta } from '../workshops/types';

/** Certification needs evidence for every current module and a passed simulation. */
export function isLearningCertified(modules: readonly { status: string; signed: boolean }[], simulationPassed: boolean): boolean {
  return modules.length > 0 && simulationPassed && modules.every(module => module.status === 'passed' && module.signed);
}

/** Use the named workshop for known IDs; preserve custom lesson titles. */
export function learningTitle(module: {id: string; title: string; cards?: {deck?: string}[] | null}): string {
  return workshopMeta[workshopDay(module) ?? 0]?.title ?? module.title;
}
