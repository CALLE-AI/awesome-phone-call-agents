<span class="o-live-dot" aria-hidden="true"></span>

<style>
	/*
	 * The solid fill carries the call in progress state against the surface at
	 * better than 8 to 1, and the soft halo only cushions it.
	 */
	.o-live-dot {
		width: 10px;
		height: 10px;
		flex: none;
		display: inline-block;
		background: var(--brand);
		border-radius: 50%;
		box-shadow: 0 0 0 4px var(--brand-soft);
		/* The pulse keeps its own period, so no transition token times it. */
		animation: o-live-pulse 1400ms ease-out infinite alternate;
	}
	@keyframes o-live-pulse {
		from {
			box-shadow: 0 0 0 2px var(--brand-soft);
		}
		to {
			box-shadow: 0 0 0 6px var(--brand-soft);
		}
	}
</style>
