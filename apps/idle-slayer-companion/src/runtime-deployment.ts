import { resolveDeployment } from '../deployment'

export const runtimeDeployment = resolveDeployment(import.meta.env?.VITE_COMPANION_TARGET)
