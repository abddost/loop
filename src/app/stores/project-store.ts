import { create } from "zustand"
import { immer } from "zustand/middleware/immer"

interface Project {
	id: string
	name: string
	directory: string
	worktree: string | null
	vcs: string | null
	createdAt: number
	updatedAt: number
}

interface ProjectState {
	projects: Project[]
	init(projects: Project[]): void
	addProject(project: Project): void
	removeProject(id: string): void
	updateProject(id: string, data: Partial<Project>): void
}

export const useProjectStore = create<ProjectState>()(
	immer((set) => ({
		projects: [],
		init(projects) {
			set((s) => {
				s.projects = projects
			})
		},
		addProject(project) {
			set((s) => {
				s.projects.push(project)
			})
		},
		removeProject(id) {
			set((s) => {
				s.projects = s.projects.filter((p) => p.id !== id)
			})
		},
		updateProject(id, data) {
			set((s) => {
				const idx = s.projects.findIndex((p) => p.id === id)
				if (idx >= 0) Object.assign(s.projects[idx], data)
			})
		},
	})),
)
