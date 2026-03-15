import type { ApprovalPolicy, PermissionConfig } from "@core/schema/permission"
import * as Config from "../config"

/**
 * Get the user's configured permission rules.
 * Returns undefined if using full-access mode (rules are ignored).
 */
export function getUserPermissionConfig(): PermissionConfig | undefined {
	const config = Config.read()
	if (config.permission.approvalPolicy === "full-access") return undefined
	return config.permission.rules
}

/**
 * Get the user's approval policy.
 */
export function getApprovalPolicy(): ApprovalPolicy {
	return Config.read().permission.approvalPolicy
}
