<!--
  PryLogo — custom mark: a box with one lid corner pried up by a crowbar.
  24x24 viewBox, stroke 1.5, currentColor, no fill.
  Conceptual anchors: box front face + tilted lid polygon + crowbar with hooked claw.
-->
<script lang="ts">
  let { class: className = '' }: { class?: string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
>
  <!-- Box front face -->
  <path d="M4 10 L4 20 L18 20 L18 10" />
  <!-- Tilted lid: left side lifted up-and-left, right side still seated -->
  <path d="M4 10 L7 5 L20 6 L18 10" />
  <!-- Right side depth face (subtle 3D hint) -->
  <path d="M18 10 L20 6 L20 17 L18 20" />
  <!-- Crowbar shaft: enters from upper right, wedged under lifted lid corner -->
  <path d="M7 5 L15 1" />
  <!-- Crowbar hooked claw curling under the lid corner -->
  <path d="M7 5 Q5 6 6 8" />
</svg>
