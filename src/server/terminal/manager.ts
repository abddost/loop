import { nanoid } from "@core/id"
import { type IPty, spawn } from "bun-pty"
import { createLogger } from "../logger"
import { Workspace } from "../workspace"

const log = createLogger("terminal")

export interface TerminalInfo {
	id: string
	title: string
	shell: string
	cwd: string
}

export interface ManagedTerminal extends TerminalInfo {
	pty: IPty
}

class TerminalManagerImpl {
	private terminals = new Map<string, ManagedTerminal>()
	private counter = 0

	constructor(private readonly cwd: string) {}

	create(cols = 80, rows = 24): ManagedTerminal {
		const id = nanoid(12)
		this.counter++
		const shell = this.resolveShell()

		const ptyProcess = spawn(shell, [], {
			name: "xterm-256color",
			cols,
			rows,
			cwd: this.cwd,
			env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
		})

		const terminal: ManagedTerminal = {
			id,
			pty: ptyProcess,
			title: `Terminal ${this.counter}`,
			shell,
			cwd: this.cwd,
		}

		this.terminals.set(id, terminal)
		log.info("Terminal created", { id, shell, cwd: this.cwd })
		return terminal
	}

	get(id: string): ManagedTerminal | undefined {
		return this.terminals.get(id)
	}

	list(): TerminalInfo[] {
		return [...this.terminals.values()].map(({ id, title, shell, cwd }) => ({
			id,
			title,
			shell,
			cwd,
		}))
	}

	resize(id: string, cols: number, rows: number): boolean {
		const terminal = this.terminals.get(id)
		if (!terminal) return false
		terminal.pty.resize(cols, rows)
		return true
	}

	close(id: string): boolean {
		const terminal = this.terminals.get(id)
		if (!terminal) return false
		terminal.pty.kill()
		this.terminals.delete(id)
		log.info("Terminal closed", { id })
		return true
	}

	dispose(): void {
		for (const [, terminal] of this.terminals) {
			try {
				terminal.pty.kill()
			} catch {
				// Process may already be dead
			}
		}
		this.terminals.clear()
		log.info("All terminals disposed")
	}

	private resolveShell(): string {
		const envShell = process.env.SHELL
		if (envShell && !SHELL_BLACKLIST.has(envShell.split("/").pop() ?? "")) {
			return envShell
		}
		return process.platform === "win32" ? "cmd.exe" : "/bin/zsh"
	}
}

const SHELL_BLACKLIST = new Set(["fish", "nu", "nushell", "elvish", "xonsh"])

/**
 * Workspace-scoped terminal manager.
 * Zero-arg access: terminalManager()
 * Automatically disposed when workspace closes.
 */
export const terminalManager = Workspace.state(
	() => new TerminalManagerImpl(Workspace.dir()),
	(mgr) => mgr.dispose(),
)
