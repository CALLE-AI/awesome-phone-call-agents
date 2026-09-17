<script lang="ts">
	import '$lib/ui/tokens.css'
	import {
		AppNav,
		Badge,
		Button,
		Card,
		EmptyState,
		Field,
		ItemLine,
		LiveDot,
		MoodMarker,
		SectionHeader,
		Stat,
		Switch
	} from '$lib/ui'

	const colourRoles = [
		'canvas',
		'surface',
		'surface-raised',
		'border',
		'border-strong',
		'text',
		'text-muted',
		'brand',
		'brand-contrast',
		'brand-soft',
		'success',
		'success-soft',
		'warning',
		'warning-soft',
		'danger',
		'danger-contrast',
		'danger-soft',
		'elevation-colour'
	]
	const pairSurfaces = ['surface', 'canvas', 'brand-soft', 'danger-soft']
	const fontSizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl']
	const lineHeights = ['tight', 'snug', 'normal']
	const weights = ['regular', 'medium', 'semibold', 'bold']
	const trackings = ['tight', 'wide']
	const spaces = ['1', '2', '3', '4', '5', '6', '8', '10', '12', '16']
	const radii = ['sm', 'md', 'lg', 'xl', 'pill']
	const elevations = ['1', '2', '3']
	const motions = ['fast', 'slow']

	let switchOn = $state(true)
	let switchOff = $state(false)
</script>

<svelte:head>
	<title>Orma design system</title>
</svelte:head>

<main class="o-gallery">
	<header class="o-gallery-head">
		<h1>Orma design system</h1>
		<p>Every token and every component, in light and in dark. The route answers 404 outside development.</p>
	</header>

	{#snippet spec()}
		<section class="o-spec">
			<h2>Colour roles</h2>
			<div class="o-swatches">
				{#each colourRoles as role (role)}
					<div class="o-swatch">
						<span class="o-chip" style={`background: var(--${role})`}></span>
						<code>--{role}</code>
					</div>
				{/each}
			</div>
		</section>

		<section class="o-spec">
			<h2>Text on a surface</h2>
			<div class="o-pairs">
				{#each pairSurfaces as surface (surface)}
					<div class="o-pair" style={`background: var(--${surface})`}>
						<code>{`--${surface}`}</code>
						<p style="color: var(--text)">Text on this surface reads at body size.</p>
						<p style="color: var(--text-muted)">Muted text on this surface reads at body size.</p>
						<p style="color: var(--brand)">Brand text on this surface, as a link or a role.</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="o-spec">
			<h2>Type</h2>
			<div class="o-spec-rows">
				<div class="o-spec-row">
					<code>--font-sans</code>
					<span style="font-family: var(--font-sans)">0123456789 Orma remembers</span>
				</div>
				<div class="o-spec-row">
					<code>--font-mono</code>
					<span style="font-family: var(--font-mono)">0123456789 08:02:10</span>
				</div>
				{#each fontSizes as size (size)}
					<div class="o-spec-row">
						<code>{`--font-size-${size}`}</code>
						<span style={`font-size: var(--font-size-${size})`}>Tomorrow, 08:00</span>
					</div>
				{/each}
				{#each lineHeights as line (line)}
					<div class="o-spec-row">
						<code>{`--line-${line}`}</code>
						<p style={`line-height: var(--line-${line}); max-width: 22rem`}>
							A pattern needs a run of days. Orma will not guess at a trend from a few mornings.
						</p>
					</div>
				{/each}
				{#each weights as weight (weight)}
					<div class="o-spec-row">
						<code>{`--weight-${weight}`}</code>
						<span style={`font-weight: var(--weight-${weight})`}>Retire, never delete</span>
					</div>
				{/each}
				{#each trackings as tracking (tracking)}
					<div class="o-spec-row">
						<code>{`--tracking-${tracking}`}</code>
						<span style={`letter-spacing: var(--tracking-${tracking})`}>Next call</span>
					</div>
				{/each}
			</div>
		</section>

		<section class="o-spec">
			<h2>Space</h2>
			<div class="o-spec-rows">
				{#each spaces as space (space)}
					<div class="o-spec-row">
						<code>{`--space-${space}`}</code>
						<span class="o-spec-space" style={`width: var(--space-${space})`}></span>
					</div>
				{/each}
			</div>
		</section>

		<section class="o-spec">
			<h2>Radius, elevation and motion</h2>
			<div class="o-tiles">
				{#each radii as radius (radius)}
					<div class="o-tile">
						<span class="o-box" style={`border-radius: var(--radius-${radius})`}></span>
						<code>{`--radius-${radius}`}</code>
					</div>
				{/each}
				{#each elevations as elevation (elevation)}
					<div class="o-tile">
						<span class="o-box" style={`border-radius: var(--radius-md); box-shadow: var(--elevation-${elevation})`}></span>
						<code>{`--elevation-${elevation}`}</code>
					</div>
				{/each}
				<div class="o-tile">
					<span class="o-box" style="border-radius: var(--radius-md); min-height: var(--tap-target)"></span>
					<code>--tap-target</code>
				</div>
			</div>
			<div class="o-spec-rows">
				{#each motions as motion (motion)}
					<div class="o-spec-row">
						<code>{`--motion-${motion}`}</code>
						<span class="o-spec-motion" style={`transition-duration: var(--motion-${motion})`}>Hover me</span>
					</div>
				{/each}
			</div>
		</section>

		<section class="o-spec">
			<h2>Button</h2>
			<div class="o-cluster">
				<Button>Start my calls</Button>
				<Button variant="secondary">Pause all calls</Button>
				<Button variant="ghost">Restore</Button>
				<Button variant="danger">Delete my account</Button>
				<Button disabled>Turn calls off</Button>
				<Button variant="secondary" href="/app">A link that looks like a button</Button>
			</div>
		</section>

		<section class="o-spec">
			<h2>Card</h2>
			<div class="o-spec-stack">
				<Card>
					<p>A plain card on the canvas.</p>
				</Card>
				<Card raised>
					<p>A raised card, lifted on the elevation two shadow.</p>
				</Card>
				<Card tone="brand">
					<p>A brand card, for the live call.</p>
				</Card>
				<Card tone="danger">
					<p>A danger card, for the zone that deletes things.</p>
				</Card>
				<Card padded={false}>
					<p class="o-inset">A card with no gutter, for rows that reach the edge.</p>
				</Card>
			</div>
		</section>

		<section class="o-spec">
			<h2>Badge and marks</h2>
			<div class="o-cluster">
				<Badge>seeded</Badge>
				<Badge tone="brand">live</Badge>
				<Badge tone="success">completed</Badge>
				<Badge tone="warning">call_failed</Badge>
				<Badge tone="danger">no_result</Badge>
				<Badge mono>scheduled</Badge>
				<span class="o-cluster-inline"><LiveDot /><span>Calling now</span></span>
				<MoodMarker label="energised" />
				<MoodMarker label="no call" none />
			</div>
		</section>

		<section class="o-spec">
			<h2>Stat</h2>
			<div class="o-tiles">
				<Stat label="Mentions" value="3" />
				<Stat label="Days since" value="34" />
				<Stat label="Calls answered" value="4" hint="of 5 completed" />
			</div>
		</section>

		<section class="o-spec">
			<h2>SectionHeader</h2>
			<div class="o-spec-stack">
				<SectionHeader title="Open" hint="Counts come from the calls" />
				<SectionHeader title="Retired" level={3}>
					<Button variant="ghost">Restore</Button>
				</SectionHeader>
			</div>
		</section>

		<section class="o-spec">
			<h2>Field</h2>
			<div class="o-spec-stack">
				<Field label="Name" hint="Orma uses this name on the call.">
					<input value="Narayan" />
				</Field>
				<Field label="Phone" error="Start with + and your country code.">
					<input value="98765" aria-invalid="true" />
				</Field>
				<Field label="Time zone">
					<select>
						<option>Asia/Kolkata</option>
						<option>Europe/London</option>
					</select>
				</Field>
				<Field label="Something to keep track of">
					<textarea rows="2">Book the dentist</textarea>
				</Field>
			</div>
		</section>

		<section class="o-spec">
			<h2>Switch</h2>
			<div class="o-spec-stack">
				<Switch label="Calls are on" checked={switchOn} onchange={(next) => (switchOn = next)} />
				<Switch label="Receipt by email" checked={switchOff} onchange={(next) => (switchOff = next)} />
				<Switch label="This one cannot change" checked disabled />
			</div>
		</section>

		<section class="o-spec">
			<h2>EmptyState</h2>
			<EmptyState title="Nothing is open yet" body="Add something you want Orma to remember.">
				<Button>Add an item</Button>
			</EmptyState>
		</section>

		<section class="o-spec">
			<h2>ItemLine</h2>
			<div class="o-spec-stack">
				<ItemLine text="Book the dentist" meta="mentioned 3 times, 34 days old" />
				<ItemLine text="Send the invoice" meta="mentioned 1 time, 8 days old" />
			</div>
		</section>

		<section class="o-spec">
			<h2>AppNav</h2>
			<AppNav path="/app/items" />
		</section>
	{/snippet}

	<div class="o-panes">
		<div class="o-pane" data-theme="light">
			<p class="o-pane-label">Light</p>
			{@render spec()}
		</div>
		<div class="o-pane" data-theme="dark">
			<p class="o-pane-label">Dark</p>
			{@render spec()}
		</div>
	</div>
</main>

<style>
	.o-gallery {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		padding: var(--space-6) var(--space-4) var(--space-16);
	}

	.o-gallery-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 46rem;
	}
	.o-gallery-head h1 {
		font-size: var(--font-size-3xl);
		font-weight: var(--weight-semibold);
		line-height: var(--line-tight);
		letter-spacing: var(--tracking-tight);
	}
	.o-gallery-head p {
		color: var(--text-muted);
	}

	.o-panes {
		display: grid;
		gap: var(--space-6);
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 1000px) {
		.o-panes {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.o-pane {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		min-width: 0;
		padding: var(--space-4);
		background: var(--canvas);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.o-pane-label {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}

	.o-spec {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}
	.o-spec h2 {
		font-size: var(--font-size-sm);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border);
		padding-bottom: var(--space-2);
	}

	code {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}

	.o-swatches {
		display: grid;
		gap: var(--space-3);
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
	}
	.o-swatch {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.o-chip {
		display: block;
		height: 3rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.o-pairs {
		display: grid;
		gap: var(--space-3);
		grid-template-columns: minmax(0, 1fr);
	}
	.o-pair {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	.o-spec-rows,
	.o-spec-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.o-spec-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3);
	}
	.o-spec-row code {
		min-width: 8rem;
	}

	.o-spec-space {
		display: block;
		height: var(--space-2);
		background: var(--brand);
		border-radius: var(--radius-pill);
	}

	.o-tiles {
		display: grid;
		gap: var(--space-3);
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
	}
	.o-tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.o-box {
		display: block;
		height: 3rem;
		background: var(--surface-raised);
		border: 1px solid var(--border);
	}

	.o-spec-motion {
		padding: var(--space-1) var(--space-3);
		background: var(--brand-soft);
		color: var(--brand);
		border-radius: var(--radius-sm);
		transition-property: background-color, color;
		transition-timing-function: ease-out;
	}
	.o-spec-motion:hover {
		background: var(--brand);
		color: var(--brand-contrast);
	}

	.o-cluster {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.o-cluster-inline {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}

	.o-inset {
		padding: var(--space-4);
	}
</style>
