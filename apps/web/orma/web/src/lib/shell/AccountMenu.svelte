<script lang="ts">
	/*
	 * The account block. On the phone the name opens a menu holding the
	 * name and Sign out. From the sidebar width the same markup reads as a
	 * static block, so one account element serves both frames.
	 */
	import { afterNavigate } from '$app/navigation'
	import { Button } from '$lib/ui'

	let { name, onsignout }: { name: string; onsignout: () => void } = $props()

	let open = $state(false)

	let root = $state<HTMLElement | null>(null)

	afterNavigate(() => {
		open = false
	})

	/*
	 * A press outside the block closes the panel. The listener lives only
	 * while the panel is open, so closing the panel or unmounting the
	 * component removes it.
	 */
	$effect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (target instanceof Node && root?.contains(target)) return
			open = false
		}
		document.addEventListener('pointerdown', onPointerDown)
		return () => document.removeEventListener('pointerdown', onPointerDown)
	})
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') open = false
	}}
/>

<div class="o-account" bind:this={root}>
	<button
		class="o-account-trigger"
		type="button"
		aria-expanded={open}
		aria-controls="o-account-panel"
		onclick={() => (open = !open)}
	>
		<span class="o-account-name">{name}</span>
		<svg
			class="o-account-chevron"
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M3.5 6l4.5 4.5L12.5 6" />
		</svg>
	</button>
	<div class="o-account-panel" class:open id="o-account-panel">
		<p class="o-account-panel-name">{name}</p>
		<Button variant="ghost" onclick={onsignout}>Sign out</Button>
	</div>
</div>

<style>
	.o-account {
		position: relative;
	}

	.o-account-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--tap-target);
		padding: 0 var(--space-2) 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
		font-size: var(--font-size-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}
	.o-account-trigger:hover {
		border-color: var(--border-strong);
	}
	.o-account-name {
		max-width: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.o-account-chevron {
		color: var(--text-muted);
		transition: transform var(--motion-fast) ease-out;
	}
	.o-account-trigger[aria-expanded='true'] .o-account-chevron {
		transform: rotate(180deg);
	}

	.o-account-panel {
		display: none;
		position: absolute;
		top: calc(100% + var(--space-2));
		right: 0;
		z-index: 6;
		min-width: 11rem;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--elevation-2);
	}
	.o-account-panel.open {
		display: flex;
	}
	.o-account-panel-name {
		padding: var(--space-1) var(--space-2);
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		overflow-wrap: anywhere;
	}

	/* The sidebar shows the account as a block rather than a menu. */
	@media (min-width: 900px) {
		.o-account-trigger {
			display: none;
		}
		.o-account-panel {
			display: flex;
			position: static;
			min-width: 0;
			padding: 0;
			border: 0;
			border-radius: 0;
			background: transparent;
			box-shadow: none;
		}
		.o-account-panel-name {
			padding: 0;
		}
		.o-account-panel :global(.o-btn) {
			align-self: flex-start;
			padding: 0;
			font-size: var(--font-size-sm);
		}
	}
</style>
