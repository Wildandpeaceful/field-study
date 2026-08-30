(() => {
  "use strict";

  // Dormant features live behind this one boundary so they can be restored for
  // evaluation or removed without touching the active composition tools.
  const features = Object.freeze({
    motionSpecimen: false,
  });

  window.fieldStudyFeatures = features;

  document.querySelectorAll('[data-feature="motion-specimen"]').forEach((element) => {
    element.hidden = !features.motionSpecimen;
  });

  if (features.motionSpecimen) {
    const script = document.createElement("script");
    script.src = "/motion-specimen.js";
    script.dataset.optionalFeature = "motion-specimen";
    document.body.append(script);
  }
})();
