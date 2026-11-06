(() => {
  const ui = globalThis.VseApp ||= {};
  const definitions = {
    key: [
      ['circle', { cx: '7.5', cy: '14.5', r: '3.5' }],
      ['path', { d: 'M11 14.5h10' }],
      ['path', { d: 'M17 14.5v-3' }],
      ['path', { d: 'M20 14.5v-2' }],
    ],
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    user: [
      ['circle', { cx: '12', cy: '8', r: '4' }],
      ['path', { d: 'M5 21a7 7 0 0 1 14 0' }],
    ],
    meat: [
      ['path', { d: 'M12.7 3.3c4.8-.5 8.1 2.5 8.1 6.8 0 5.5-4.4 10.5-9.8 10.5-4.4 0-7.8-2.7-7.8-6.7 0-3.1 1.9-5.7 4.7-7.1 1.7-.9 2.5-3.2 4.8-3.5Z' }],
      ['path', { d: 'M12.6 7.3c2.7-.4 4.6 1.2 4.6 3.4 0 2.7-2.5 5-5.2 5-2.2 0-3.8-1.4-3.8-3.5 0-1.8 1.7-3.3 4.4-4.9Z' }],
    ],
    milk: [
      ['path', { d: 'M9 3h6v3l1.5 2.5V19a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V8.5L9 6V3Z' }],
      ['path', { d: 'M9 6h6M7.5 11h9M7.5 16h9' }],
    ],
    camera: [
      ['path', { d: 'M4.826 9.62a.957.957 0 0 1-.956-.953V6.762H1.957A.957.957 0 0 1 1 5.81c0-.524.43-.953.957-.953H3.87V2.952a.957.957 0 0 1 1.913 0v1.905h1.913c.526 0 .956.429.956.953 0 .523-.43.952-.956.952H5.783v1.905c0 .523-.43.952-.957.952Z' }],
      ['path', { d: 'M17 14.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z' }],
      ['path', { d: 'M18.055 6.762h3.032c1.052 0 1.913.857 1.913 1.905v11.428C23 21.143 22.14 22 21.087 22H5.783a1.915 1.915 0 0 1-1.913-1.905v-9.79c.287.162.602.266.956.266A1.914 1.914 0 0 0 6.74 8.667v-.953h.957A1.915 1.915 0 0 0 9.609 5.81c0-.353-.105-.667-.268-.953h6.122a1.91 1.91 0 0 1 1.406.62l1.186 1.285ZM19 14.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z', 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' }],
    ],
  };

  ui.createIcon = name => {
    const definition = definitions[name];
    if (!definition) throw new TypeError('Неподдерживаемая иконка');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('app-icon');
    svg.dataset.icon = name;
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attributes] of definition) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [attribute, value] of Object.entries(attributes)) node.setAttribute(attribute, value);
      svg.append(node);
    }
    return svg;
  };
})();
