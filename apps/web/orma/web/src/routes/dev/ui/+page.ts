import { dev } from '$app/environment'
import { error } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/**
 * The gallery is a development tool, and only a development tool.
 * `dev` is false in every build, so a production server answers 404 here.
 * See the handoff for the build-time define that makes that true.
 */
export const load: PageLoad = () => {
	if (!dev) error(404, 'Not found')
	return {}
}
