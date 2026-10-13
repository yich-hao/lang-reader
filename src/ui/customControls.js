const initializedSegmentedControls = new WeakSet();
const initializedSliders = new WeakSet();
const segmentRejections = new WeakMap();

export function showSegmentRejection(button, { label, message, duration = 900 }) {
  if (!button) return;
  clearSegmentRejection(button);
  const originalLabel = button.textContent;
  const originalAriaLabel = button.getAttribute('aria-label');
  button.textContent = label;
  button.setAttribute('aria-label', message);
  button.classList.add('segment-rejected');

  let announcer = document.querySelector('#segment-feedback-announcer');
  if (!announcer) {
    announcer = document.createElement('span');
    announcer.id = 'segment-feedback-announcer';
    announcer.className = 'sr-only';
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    document.body.append(announcer);
  }
  announcer.textContent = message;
  const timeoutId = window.setTimeout(() => clearSegmentRejection(button), duration);
  segmentRejections.set(button, { originalLabel, originalAriaLabel, timeoutId });
}

export function clearSegmentRejection(button) {
  const rejection = segmentRejections.get(button);
  if (!rejection) return;
  window.clearTimeout(rejection.timeoutId);
  button.textContent = rejection.originalLabel;
  if (rejection.originalAriaLabel === null) button.removeAttribute('aria-label');
  else button.setAttribute('aria-label', rejection.originalAriaLabel);
  button.classList.remove('segment-rejected');
  segmentRejections.delete(button);
}

export function initSegmentedControls(root = document) {
  const controls = [...root.querySelectorAll('.segmented-control')]
    .filter((ctrl) => !initializedSegmentedControls.has(ctrl));

  controls.forEach(ctrl => {
    initializedSegmentedControls.add(ctrl);
    const indicator = ctrl.querySelector('.segment-indicator');
    if (!indicator) return;
    
    // Track the currently active button
    let currentActive = ctrl.querySelector('.segment-btn.active');
    
    // Position it initially
    if (currentActive) {
      applySegmentButtonStyles(ctrl, currentActive);
      repositionIndicator(ctrl, currentActive, indicator);
    }
    
    // Observe class changes on all buttons inside this control
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target;
          if (target.classList.contains('active')) {
            if (target !== currentActive) {
              const previousActive = currentActive;
              currentActive = target;
              
              if (previousActive) {
                animateSegmentIndicator(ctrl, previousActive, target, indicator);
              } else {
                applySegmentButtonStyles(ctrl, target);
                repositionIndicator(ctrl, target, indicator);
              }
            }
          }
        }
      });
    });
    
    ctrl.querySelectorAll('.segment-btn').forEach(btn => {
      observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
    });
  });
  
  controls.forEach(ctrl => {
    ctrl.addEventListener('pointermove', (e) => {
      const rect = ctrl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ctrl.style.setProperty('--mouse-x', `${x}px`);
      ctrl.style.setProperty('--mouse-y', `${y}px`);
    });
    
    ctrl.addEventListener('pointerleave', () => {
      ctrl.style.removeProperty('--mouse-x');
      ctrl.style.removeProperty('--mouse-y');
    });
  });
}

export function repositionAllSegmentedControls(root = document) {
  root.querySelectorAll('.segmented-control').forEach(ctrl => {
    const activeBtn = ctrl.querySelector('.segment-btn.active');
    const indicator = ctrl.querySelector('.segment-indicator');
    if (activeBtn && indicator) {
      applySegmentButtonStyles(ctrl, activeBtn);
      repositionIndicator(ctrl, activeBtn, indicator);
    }
  });
}

function applySegmentButtonStyles(ctrl, activeBtn) {
  if (!ctrl.classList.contains('full-width-segmented') || ctrl.classList.contains('parse-mode-control')) {
    return;
  }
  ctrl.querySelectorAll('.segment-btn').forEach(btn => {
    if (btn === activeBtn) {
      btn.style.flex = "1.6 1 0%";
      btn.style.fontSize = "12px";
      btn.style.opacity = "1.0";
      btn.style.fontWeight = "700";
      btn.style.color = "var(--accent-strong)";
    } else {
      btn.style.flex = "0.8 1 0%";
      btn.style.fontSize = "9.5px";
      btn.style.opacity = "0.6";
      btn.style.fontWeight = "500";
      btn.style.color = "var(--muted)";
    }
  });
}

function repositionIndicator(ctrl, activeBtn, indicator) {
  if (!activeBtn || !indicator) return;
  const geometry = getIndicatorGeometry(ctrl, activeBtn);
  indicator.style.width = `${geometry.width}px`;
  if (ctrl.classList.contains('parse-mode-control')) {
    indicator.style.height = `${geometry.height}px`;
    indicator.style.left = `${geometry.left}px`;
    indicator.style.top = `${geometry.top}px`;
    indicator.style.transform = 'none';
    return;
  }
  indicator.style.transform = `translateX(${geometry.left - 2}px)`;
}

function animateSegmentIndicator(ctrl, prevActive, targetActive, indicator) {
  if (ctrl.classList.contains('parse-mode-control')) {
    animateIndicatorGeometry(ctrl, prevActive, targetActive, indicator);
    return;
  }
  const buttons = ctrl.querySelectorAll('.segment-btn');
  
  if (ctrl.animationId) {
    cancelAnimationFrame(ctrl.animationId);
  }
  
  const startFlexes = [];
  const startSizes = [];
  const startOpacities = [];
  buttons.forEach(btn => {
    const style = window.getComputedStyle(btn);
    startFlexes.push(parseFloat(style.flexGrow) || 0.8);
    startSizes.push(parseFloat(style.fontSize) || 9.5);
    startOpacities.push(parseFloat(style.opacity) || 0.6);
  });
  
  const targetFlexes = [];
  const targetSizes = [];
  const targetOpacities = [];
  buttons.forEach(btn => {
    if (btn === targetActive) {
      targetFlexes.push(1.6);
      targetSizes.push(12);
      targetOpacities.push(1.0);
    } else {
      targetFlexes.push(0.8);
      targetSizes.push(9.5);
      targetOpacities.push(0.6);
    }
  });
  
  ctrl.classList.add('no-transitions');
  const origClasses = [];
  const origFlexes = [];
  const origFontSizes = [];
  buttons.forEach(btn => {
    origClasses.push(btn.className);
    origFlexes.push(btn.style.flex);
    origFontSizes.push(btn.style.fontSize);
    
    if (btn === targetActive) {
      btn.classList.add('active');
      btn.style.flex = "1.6 1 0%";
      btn.style.fontSize = "12px";
    } else {
      btn.classList.remove('active');
      btn.style.flex = "0.8 1 0%";
      btn.style.fontSize = "9.5px";
    }
  });
  
  const targetLeft = targetActive.offsetLeft;
  const targetWidth = targetActive.offsetWidth;
  
  buttons.forEach((btn, i) => {
    btn.className = origClasses[i];
    btn.style.flex = origFlexes[i];
    btn.style.fontSize = origFontSizes[i];
  });
  ctrl.classList.remove('no-transitions');
  
  const startLeft = prevActive.offsetLeft;
  const startTime = performance.now();
  const duration = 250;
  
  function run(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4); // easeOutQuart
    
    buttons.forEach((btn, i) => {
      const flexVal = startFlexes[i] + (targetFlexes[i] - startFlexes[i]) * eased;
      const size = startSizes[i] + (targetSizes[i] - startSizes[i]) * eased;
      const opacity = startOpacities[i] + (targetOpacities[i] - startOpacities[i]) * eased;
      
      btn.style.flex = `${flexVal} 1 0%`;
      btn.style.fontSize = size + 'px';
      btn.style.opacity = opacity;
      
      if (flexVal > 1.2) {
        btn.style.fontWeight = '700';
        btn.style.color = 'var(--accent-strong)';
      } else {
        btn.style.fontWeight = '500';
        btn.style.color = 'var(--muted)';
      }
    });
    
    indicator.style.width = targetWidth + 'px';
    const currentLeft = startLeft + (targetLeft - startLeft) * eased;
    indicator.style.transform = `translateX(${currentLeft - 2}px)`;
    
    if (progress < 1) {
      ctrl.animationId = requestAnimationFrame(run);
    } else {
      buttons.forEach((btn, i) => {
        btn.style.flex = `${targetFlexes[i]} 1 0%`;
        btn.style.fontSize = targetSizes[i] + 'px';
        btn.style.opacity = targetOpacities[i];
        if (btn === targetActive) {
          btn.style.fontWeight = '700';
          btn.style.color = 'var(--accent-strong)';
        } else {
          btn.style.fontWeight = '500';
          btn.style.color = 'var(--muted)';
        }
      });
      indicator.style.width = targetWidth + 'px';
      indicator.style.transform = `translateX(${targetLeft - 2}px)`;
    }
  }
  
  ctrl.animationId = requestAnimationFrame(run);
}

function animateIndicatorGeometry(ctrl, previousActive, targetActive, indicator) {
  if (ctrl.animationId) cancelAnimationFrame(ctrl.animationId);
  const start = getIndicatorGeometry(ctrl, previousActive);
  const target = getIndicatorGeometry(ctrl, targetActive);
  const startTime = performance.now();
  const duration = 250;

  function run(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    const left = start.left + (target.left - start.left) * eased;
    const top = start.top + (target.top - start.top) * eased;
    const width = start.width + (target.width - start.width) * eased;
    const height = start.height + (target.height - start.height) * eased;
    indicator.style.width = `${width}px`;
    indicator.style.height = `${height}px`;
    indicator.style.left = `${left}px`;
    indicator.style.top = `${top}px`;
    indicator.style.transform = 'none';
    if (progress < 1) ctrl.animationId = requestAnimationFrame(run);
  }

  ctrl.animationId = requestAnimationFrame(run);
}

function getIndicatorGeometry(ctrl, button) {
  const controlRect = ctrl.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const isParseControl = ctrl.classList.contains('parse-mode-control');
  return {
    left: buttonRect.left - controlRect.left,
    top: isParseControl
      ? (button.classList.contains('study-segment-option') ? 32 : 2)
      : buttonRect.top - controlRect.top,
    width: buttonRect.width,
    height: isParseControl ? 28 : buttonRect.height
  };
}

export function initCustomSliders(root = document) {
  root.querySelectorAll('.discrete-slider-wrapper, .continuous-slider-wrapper').forEach(wrapper => {
    if (initializedSliders.has(wrapper)) return;
    initializedSliders.add(wrapper);
    const input = wrapper.querySelector('input[type="range"]');
    if (!input) return;
    
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    
    input.dataset.lastValue = input.value;
    
    input.addEventListener('input', () => {
      if (input.step !== 'any') {
        input.dataset.lastValue = input.value;
      }
    });
    
    const slideToCoords = (clientX) => {
      if (input.disabled) return;
      const rect = input.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width));
      const step = parseFloat(input.step) || 1;
      const rawVal = min + percentage * (max - min);
      
      const decimalPlaces = (step.toString().split('.')[1] || '').length;
      const targetValueStr = (min + Math.round((rawVal - min) / step) * step).toFixed(decimalPlaces);
      const targetValue = parseFloat(targetValueStr);
      const currentValue = parseFloat(input.value);
      
      if (targetValue !== currentValue) {
        animateSliderValue(input, currentValue, targetValue, 250);
      }
    };
    
    wrapper.addEventListener('pointerdown', (e) => {
      if (input.disabled || e.target === input) return;
      e.preventDefault();
      slideToCoords(e.clientX);
    });
    
    input.addEventListener('pointerdown', (e) => {
      const rect = input.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const currentValue = parseFloat(input.value);
      const thumbX = ((currentValue - min) / (max - min)) * rect.width;
      
      const isNearThumb = Math.abs(clickX - thumbX) < 15;
      
      if (!isNearThumb) {
        e.preventDefault();
        slideToCoords(e.clientX);
      } else if (input.animationId) {
        cancelAnimationFrame(input.animationId);
        input.animationId = 0;
      }
    });
  });
}

function animateSliderValue(input, start, target, duration) {
  const startTime = performance.now();
  const originalStep = input.getAttribute('step') || '1';
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  
  if (input.animationId) {
    cancelAnimationFrame(input.animationId);
  }
  
  
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    const rawValue = start + (target - start) * eased;
    
    const stepVal = parseFloat(originalStep) || 1;
    const decimalPlaces = (stepVal.toString().split('.')[1] || '').length;
    const steppedValue = Math.round((rawValue - min) / stepVal) * stepVal + min;
    const clampedValue = Math.max(min, Math.min(max, steppedValue));
    
    input.value = clampedValue.toFixed(decimalPlaces);
    input.dispatchEvent(new Event('input'));
    
    if (progress < 1) {
      input.animationId = requestAnimationFrame(update);
    } else {
      input.animationId = 0;
      input.step = originalStep;
      input.value = target;
      input.dataset.lastValue = target;
      input.dispatchEvent(new Event('input'));
    }
  }
  
  input.animationId = requestAnimationFrame(update);
}
