<script lang="ts">
	/*
	 * One glyph per app tab. Each draws on the 16 pixel grid and the 1.6
	 * stroke the design icons use, so the tab row reads with the rest.
	 */
	let { href }: { href: string } = $props()
</script>

<svg
	class="o-tab-icon"
	viewBox="0 0 16 16"
	width="20"
	height="20"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if href === '/app'}
		<rect x="2.6" y="3.6" width="10.8" height="9.8" rx="1.8" />
		<path d="M2.6 6.6h10.8M5.6 2.2v2.6M10.4 2.2v2.6" />
	{:else if href === '/app/items'}
		<path d="M6 4.6h7.4M6 8h7.4M6 11.4h7.4" />
		<circle cx="3" cy="4.6" r="0.9" fill="currentColor" stroke="none" />
		<circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
		<circle cx="3" cy="11.4" r="0.9" fill="currentColor" stroke="none" />
	{:else if href === '/app/history'}
		<circle cx="8" cy="8" r="5.4" />
		<path d="M8 5.2v3.1l2.2 1.5" />
	{:else if href === '/app/patterns'}
		<path d="M2.6 12.4h10.8" />
		<path d="M4.4 9.6l2.5-3.1 2.2 1.9 2.9-3.6" />
	{:else if href === '/app/timeline'}
		<path d="M4.4 2.6v10.8" />
		<circle cx="4.4" cy="5.4" r="1.5" />
		<circle cx="4.4" cy="10.6" r="1.5" />
		<path d="M7.6 5.4h5.8M7.6 10.6h5.8" />
	{:else if href === '/app/settings'}
		<path d="M2.6 5.2h3.1M8.9 5.2h4.5M2.6 10.8h5.6M11.4 10.8h2" />
		<circle cx="7.3" cy="5.2" r="1.6" />
		<circle cx="9.8" cy="10.8" r="1.6" />
	{/if}
</svg>

<style>
	.o-tab-icon {
		display: block;
		flex: none;
	}
</style>
