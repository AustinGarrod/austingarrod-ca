import type { SetBinder } from "./master";
import type { BinderSettings } from "./model";

export const binderSharePath = "/utilities/pokemon-binder/shared/";
export const binderShareToken = /^pbs_[a-f0-9]{64}$/;

export type SharedBinder =
  | { kind: "national"; settings: BinderSettings; ownedDexIds: number[]; orderedDexIds: number[] }
  | ({ kind: "set" } & Omit<SetBinder, "id">);
