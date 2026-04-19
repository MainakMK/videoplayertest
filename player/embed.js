(function () {
  var script = document.currentScript;
  if (!script) {
    // Fallback for older browsers
    var scripts = document.getElementsByTagName('script');
    script = scripts[scripts.length - 1];
  }

  var videoId = script.getAttribute('data-id');
  if (!videoId) {
    console.error('[VideoPlayer] Missing data-id attribute on embed script.');
    return;
  }

  // Determine the player origin from the script src
  var playerOrigin = '';
  var src = script.getAttribute('src') || '';
  if (src) {
    try {
      var url = new URL(src, window.location.href);
      playerOrigin = url.origin;
    } catch (e) {
      // If URL parsing fails, use relative path
      playerOrigin = '';
    }
  }

  var playerUrl = playerOrigin + '/v/' + videoId;

  // Read optional attributes
  var width = script.getAttribute('data-width') || '100%';
  var height = script.getAttribute('data-height') || '';
  var aspectRatio = script.getAttribute('data-ratio') || '16/9';

  // Create wrapper
  var wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = width;
  wrapper.style.maxWidth = '100%';

  if (height) {
    wrapper.style.height = height;
  } else {
    // Use aspect ratio for responsive sizing
    wrapper.style.aspectRatio = aspectRatio;
  }

  wrapper.style.overflow = 'hidden';
  wrapper.style.borderRadius = '8px';
  wrapper.style.background = '#000';

  // Create iframe
  var iframe = document.createElement('iframe');
  iframe.src = playerUrl;
  iframe.style.position = 'absolute';
  iframe.style.top = '0';
  iframe.style.left = '0';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('title', 'Video Player');

  wrapper.appendChild(iframe);

  // Insert the player after the script tag
  script.parentNode.insertBefore(wrapper, script.nextSibling);
})();
