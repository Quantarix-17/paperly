// ========================================================================
// ELEMENT LIBRARY — small, high-quality SVG components + flat-icon pieces
// ========================================================================
// Same choke-point pattern as diagram-library.js / chart-library.js /
// illustration-library.js, but for tiny, REUSABLE building-block elements.
//
// Every element is authored in a fixed 0..100 x 0..100 local box, so:
//   - the AI can place it ANYWHERE (x, y = its top-left position)
//   - the AI can size it to WHATEVER IT WANTS (size = width/height)
//   - the AI can rotate it (rotate = degrees) and recolor it (color /
//     color2 / color3 / color4 / color5) without touching its internal paths.
//
// Placeholder syntax:
//   <!--ELEMENT:element_id:size=40|x=10|y=10|color=#f5a623|color2=#ffffff|rotate=0-->
// ========================================================================

function _elEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _elParseParams(paramString) {
  const out = { size: 100, x: 0, y: 0, rotate: 0, color: '', color2: '', color3: '', color4: '', color5: '', stroke: '' };
  if (!paramString || typeof paramString !== 'string') return out;
  paramString.split('|').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq === -1) return;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const value = pair.slice(eq + 1).trim();
    if (key === 'size' || key === 'x' || key === 'y' || key === 'rotate') {
      const n = parseFloat(value);
      out[key] = Number.isFinite(n) ? n : out[key];
    } else if (key === 'color' || key === 'color2' || key === 'color3' || key === 'color4' || key === 'color5' || key === 'stroke') {
      out[key] = value;
    }
  });
  return out;
}

// ========================================================================
// CATEGORIES  (39 categories, 376 elements total — every category doubled)
// ========================================================================
const ELEMENT_CATEGORIES = {
  sky_nature: {
    label: 'Sky & nature — sun, moon, cloud, star, rainbow, sunrise, comet, aurora, tornado, fog',
    elements: {
      sun: { keywords: ['sun', 'সূর্য', 'sunshine', 'sunny'], defaultColor: '#f5a623', render: renderElSun },
      moon: { keywords: ['moon', 'চাঁদ', 'crescent'], defaultColor: '#e8ecf5', render: renderElMoon },
      cloud: { keywords: ['cloud', 'মেঘ'], defaultColor: '#ffffff', render: renderElCloud },
      star: { keywords: ['star', 'তারা', 'তারকা'], defaultColor: '#f7c948', render: renderElStar },
      rainbow: { keywords: ['rainbow', 'রংধনু'], defaultColor: '#e04f4f', render: renderElRainbow },
      mountain_peak: { keywords: ['mountain', 'mountain peak', 'পাহাড়', 'পর্বত'], defaultColor: '#7d8ba1', render: renderElMountainPeak },
      wind_swirl: { keywords: ['wind', 'wind swirl', 'বাতাস', 'breeze'], defaultColor: '#8ab4d9', render: renderElWindSwirl },
      sunrise: { keywords: ['sunrise', 'sun rising', 'সূর্যোদয়'], defaultColor: '#f5a623', render: renderElSunrise },
      sunset: { keywords: ['sunset', 'dusk', 'সূর্যাস্ত'], defaultColor: '#e0654f', render: renderElSunset },
      comet: { keywords: ['comet', 'shooting star', 'ধূমকেতু'], defaultColor: '#f7c948', render: renderElComet },
      aurora: { keywords: ['aurora', 'northern lights', 'মেরুপ্রভা'], defaultColor: '#22c55e', render: renderElAurora },
      tornado: { keywords: ['tornado', 'twister', 'ঘূর্ণিঝড়'], defaultColor: '#7d8ba1', render: renderElTornado },
      fog_mist: { keywords: ['fog', 'mist', 'কুয়াশা'], defaultColor: '#c7d0dc', render: renderElFogMist },
      eclipse: { keywords: ['eclipse', 'solar eclipse', 'সূর্যগ্রহণ'], defaultColor: '#2b2b40', render: renderElEclipse }
    }
  },
  weather: {
    label: 'Weather — raindrop, snowflake, lightning, hail, thermometer, storm, frost',
    elements: {
      raindrop: { keywords: ['raindrop', 'rain drop', 'বৃষ্টির ফোঁটা', 'rain'], defaultColor: '#4f9de0', render: renderElRaindrop },
      snowflake: { keywords: ['snowflake', 'তুষারকণা', 'snow'], defaultColor: '#bfe3f5', render: renderElSnowflake },
      lightning_bolt: { keywords: ['lightning', 'lightning bolt', 'বজ্র', 'thunder'], defaultColor: '#f5c518', render: renderElLightningBolt },
      sun_cloud: { keywords: ['partly cloudy', 'sun cloud', 'মেঘলা রোদ'], defaultColor: '#f5a623', render: renderElSunCloud },
      umbrella: { keywords: ['umbrella', 'ছাতা'], defaultColor: '#4f7df3', render: renderElUmbrella },
      hail_stones: { keywords: ['hail', 'hailstones', 'শিলাবৃষ্টি'], defaultColor: '#bfe3f5', render: renderElHailStones },
      thermometer: { keywords: ['thermometer', 'temperature', 'তাপমাত্রা'], defaultColor: '#e04f4f', render: renderElThermometer },
      weather_vane: { keywords: ['weather vane', 'wind vane', 'বাতাসের দিকনির্ণয়'], defaultColor: '#4a5568', render: renderElWeatherVane },
      storm_cloud: { keywords: ['storm cloud', 'thundercloud', 'ঝড়ো মেঘ'], defaultColor: '#4a5568', render: renderElStormCloud },
      frost_pattern: { keywords: ['frost', 'frost pattern', 'তুষারপাত'], defaultColor: '#bfe3f5', render: renderElFrostPattern }
    }
  },
  home_objects: {
    label: 'Home objects — house, key, lightbulb, sofa, chair, table, mirror, vase, bed, rug, curtain, door',
    elements: {
      house: { keywords: ['house', 'home', 'ঘর', 'বাড়ি'], defaultColor: '#d9734e', render: renderElHouse },
      key: { keywords: ['key', 'চাবি'], defaultColor: '#d9a441', render: renderElKey },
      lightbulb: { keywords: ['lightbulb', 'light bulb', 'বাল্ব', 'idea bulb'], defaultColor: '#f5c518', render: renderElLightbulb },
      sofa: { keywords: ['sofa', 'couch', 'সোফা'], defaultColor: '#4f7df3', render: renderElSofa },
      curtain: { keywords: ['curtain', 'পর্দা'], defaultColor: '#e04f4f', render: renderElCurtain },
      door: { keywords: ['door', 'দরজা'], defaultColor: '#6d4a2f', render: renderElDoor },
      chair: { keywords: ['chair', 'চেয়ার'], defaultColor: '#d9a441', render: renderElChair },
      table: { keywords: ['table', 'টেবিল'], defaultColor: '#8a5a2f', render: renderElTable },
      mirror: { keywords: ['mirror', 'আয়না'], defaultColor: '#bfe3f5', render: renderElMirror },
      vase: { keywords: ['vase', 'ফুলদানি'], defaultColor: '#4f9de0', render: renderElVase },
      bed: { keywords: ['bed', 'বিছানা'], defaultColor: '#4f7df3', render: renderElBed },
      rug: { keywords: ['rug', 'carpet', 'কার্পেট'], defaultColor: '#e04f4f', render: renderElRug }
    }
  },
  desk_objects: {
    label: 'Desk objects — pen, clock, book, notebook, calculator, eraser, scissors, tape',
    elements: {
      pen: { keywords: ['pen', 'কলম'], defaultColor: '#2f6fb3', render: renderElPen },
      clock: { keywords: ['clock', 'ঘড়ি', 'watch', 'time'], defaultColor: '#3f6fb0', render: renderElClock },
      book: { keywords: ['book', 'বই'], defaultColor: '#3f7d5c', render: renderElBook },
      notebook: { keywords: ['notebook', 'notepad', 'খাতা'], defaultColor: '#4f7df3', render: renderElNotebook },
      calculator: { keywords: ['calculator', 'ক্যালকুলেটর'], defaultColor: '#2b2b40', render: renderElCalculator },
      paperclip: { keywords: ['paperclip', 'paper clip', 'ক্লিপ'], defaultColor: '#8a8f9c', render: renderElPaperclip },
      stapler: { keywords: ['stapler', 'স্টেপলার'], defaultColor: '#e04f4f', render: renderElStapler },
      eraser: { keywords: ['eraser', 'rubber', 'রাবার'], defaultColor: '#f28ba8', render: renderElEraser },
      scissors: { keywords: ['scissors', 'কাঁচি'], defaultColor: '#8a8f9c', render: renderElScissors },
      tape_dispenser: { keywords: ['tape dispenser', 'sticky tape', 'টেপ ডিসপেনসার'], defaultColor: '#4f7df3', render: renderElTapeDispenser },
      highlighter: { keywords: ['highlighter', 'marker', 'হাইলাইটার'], defaultColor: '#f5d76e', render: renderElHighlighter },
      magnifier: { keywords: ['magnifier', 'magnifying glass', 'আতশ কাচ'], defaultColor: '#4a5568', render: renderElMagnifier },
      binder_clip: { keywords: ['binder clip', 'binder', 'ক্লিপ বাইন্ডার'], defaultColor: '#2b2b40', render: renderElBinderClip },
      desk_organizer: { keywords: ['desk organizer', 'pen holder', 'ডেস্ক অর্গানাইজার'], defaultColor: '#4a5568', render: renderElDeskOrganizer }
    }
  },
  education: {
    label: 'Education — graduation cap, pencil, backpack, microscope, school bus, library',
    elements: {
      graduation_cap: { keywords: ['graduation cap', 'grad cap', 'গ্রাজুয়েশন ক্যাপ'], defaultColor: '#2b2b40', render: renderElGraduationCap },
      pencil: { keywords: ['pencil', 'পেন্সিল'], defaultColor: '#f2b632', render: renderElPencil },
      backpack: { keywords: ['backpack', 'school bag', 'ব্যাগ'], defaultColor: '#4f7df3', render: renderElBackpack },
      ruler: { keywords: ['ruler', 'scale', 'স্কেল'], defaultColor: '#f2b632', render: renderElRuler },
      globe_stand: { keywords: ['globe stand', 'desk globe', 'গ্লোব স্ট্যান্ড'], defaultColor: '#2f7d6a', render: renderElGlobeStand },
      chalkboard: { keywords: ['chalkboard', 'blackboard', 'ব্ল্যাকবোর্ড'], defaultColor: '#2f5c40', render: renderElChalkboard },
      microscope: { keywords: ['microscope', 'মাইক্রোস্কোপ'], defaultColor: '#4a5568', render: renderElMicroscope },
      school_bus: { keywords: ['school bus', 'স্কুল বাস'], defaultColor: '#f2b632', render: renderElSchoolBus },
      report_card: { keywords: ['report card', 'grades', 'রিপোর্ট কার্ড'], defaultColor: '#4f7df3', render: renderElReportCard },
      lunch_box: { keywords: ['lunch box', 'tiffin box', 'টিফিন বাক্স'], defaultColor: '#e04f4f', render: renderElLunchBox },
      library_shelf: { keywords: ['library shelf', 'bookshelf', 'বইয়ের তাক'], defaultColor: '#6d4a2f', render: renderElLibraryShelf },
      abacus: { keywords: ['abacus', 'গণনার তক্তা'], defaultColor: '#d9a441', render: renderElAbacus }
    }
  },
  tech: {
    label: 'Technology — phone, laptop, wifi, keyboard, mouse, monitor, USB, router, smartwatch',
    elements: {
      mobile_phone: { keywords: ['mobile phone', 'smartphone', 'মোবাইল'], defaultColor: '#2b2b40', render: renderElMobilePhone },
      laptop: { keywords: ['laptop', 'ল্যাপটপ'], defaultColor: '#4a5568', render: renderElLaptop },
      wifi_signal: { keywords: ['wifi', 'wifi signal', 'ওয়াইফাই'], defaultColor: '#2f7d6a', render: renderElWifiSignal },
      tablet_device: { keywords: ['tablet', 'ট্যাবলেট'], defaultColor: '#4a5568', render: renderElTabletDevice },
      headphones: { keywords: ['headphones', 'headset', 'হেডফোন'], defaultColor: '#2b2b40', render: renderElHeadphones },
      camera_icon: { keywords: ['camera', 'ক্যামেরা'], defaultColor: '#2b2b40', render: renderElCameraIcon },
      printer: { keywords: ['printer', 'প্রিন্টার'], defaultColor: '#8a8f9c', render: renderElPrinter },
      keyboard: { keywords: ['keyboard', 'কীবোর্ড'], defaultColor: '#2b2b40', render: renderElKeyboard },
      mouse_device: { keywords: ['computer mouse', 'mouse', 'মাউস'], defaultColor: '#2b2b40', render: renderElMouseDevice },
      monitor: { keywords: ['monitor', 'display', 'মনিটর'], defaultColor: '#4a5568', render: renderElMonitor },
      usb_drive: { keywords: ['usb', 'usb drive', 'flash drive', 'ইউএসবি'], defaultColor: '#8a8f9c', render: renderElUsbDrive },
      hard_drive: { keywords: ['hard drive', 'external drive', 'হার্ড ড্রাইভ'], defaultColor: '#4a5568', render: renderElHardDrive },
      router: { keywords: ['router', 'wifi router', 'রাউটার'], defaultColor: '#2b2b40', render: renderElRouter },
      smartwatch: { keywords: ['smartwatch', 'smart watch', 'স্মার্টওয়াচ'], defaultColor: '#4f7df3', render: renderElSmartwatch }
    }
  },
  icons_ui: {
    label: 'UI icons — check, star, arrow, close, menu, search',
    elements: {
      icon_check: { keywords: ['check icon', 'checkmark', 'ঠিক চিহ্ন'], defaultColor: '#2f9e5c', render: renderElIconCheck },
      icon_star_badge: { keywords: ['star icon', 'star badge', 'rating star'], defaultColor: '#f2b632', render: renderElIconStarBadge },
      icon_arrow_right: { keywords: ['arrow icon', 'arrow right', 'তীর চিহ্ন'], defaultColor: '#4f7df3', render: renderElIconArrowRight },
      icon_close: { keywords: ['close icon', 'x icon', 'cross icon', 'বন্ধ আইকন'], defaultColor: '#e04f4f', render: renderElIconClose },
      icon_menu: { keywords: ['menu icon', 'hamburger', 'মেনু আইকন'], defaultColor: '#2b2b40', render: renderElIconMenu },
      icon_search: { keywords: ['search icon', 'magnifier icon', 'সার্চ আইকন'], defaultColor: '#4f7df3', render: renderElIconSearch }
    }
  },
  icons_concept: {
    label: 'Concept icons — graph, school, target, idea, growth, team',
    elements: {
      icon_graph: { keywords: ['graph icon', 'chart icon', 'গ্রাফ আইকন'], defaultColor: '#4f7df3', render: renderElIconGraph },
      icon_school: { keywords: ['school icon', 'স্কুল আইকন'], defaultColor: '#b3432f', render: renderElIconSchool },
      icon_target: { keywords: ['target icon', 'goal icon', 'লক্ষ্য আইকন'], defaultColor: '#e04f4f', render: renderElIconTarget },
      icon_idea: { keywords: ['idea icon', 'bulb icon', 'আইডিয়া আইকন'], defaultColor: '#f2b632', render: renderElIconIdea },
      icon_growth: { keywords: ['growth icon', 'growth arrow', 'প্রবৃদ্ধি আইকন'], defaultColor: '#22c55e', render: renderElIconGrowth },
      icon_team: { keywords: ['team icon', 'group icon', 'দল আইকন'], defaultColor: '#4f7df3', render: renderElIconTeam }
    }
  },
  shapes_basic: {
    label: 'Basic shapes — circle, square, triangle, hexagon, pentagon, oval, diamond, octagon, rhombus, star, cross, crescent',
    elements: {
      circle_shape: { keywords: ['circle', 'বৃত্ত'], defaultColor: '#4f7df3', render: renderElCircleShape },
      square_shape: { keywords: ['square', 'বর্গ'], defaultColor: '#22c55e', render: renderElSquareShape },
      triangle_shape: { keywords: ['triangle', 'ত্রিভুজ'], defaultColor: '#f59e0b', render: renderElTriangleShape },
      hexagon_shape: { keywords: ['hexagon', 'ষড়ভুজ'], defaultColor: '#4f9de0', render: renderElHexagonShape },
      pentagon_shape: { keywords: ['pentagon', 'পঞ্চভুজ'], defaultColor: '#e04f4f', render: renderElPentagonShape },
      oval_shape: { keywords: ['oval', 'ellipse', 'ডিম্বাকার'], defaultColor: '#a855f7', render: renderElOvalShape },
      diamond_shape: { keywords: ['diamond', 'হীরক'], defaultColor: '#4f9de0', render: renderElDiamondShape },
      octagon_shape: { keywords: ['octagon', 'অষ্টভুজ'], defaultColor: '#e04f4f', render: renderElOctagonShape },
      rhombus_shape: { keywords: ['rhombus', 'রম্বস'], defaultColor: '#22c55e', render: renderElRhombusShape },
      star_shape: { keywords: ['star shape', 'তারকা আকৃতি'], defaultColor: '#f7c948', render: renderElStarShape },
      cross_shape: { keywords: ['cross', 'plus shape', 'ক্রস'], defaultColor: '#4f7df3', render: renderElCrossShape },
      crescent_shape: { keywords: ['crescent shape', 'crescent moon', 'অর্ধচন্দ্র'], defaultColor: '#a855f7', render: renderElCrescentShape }
    }
  },
  shapes_decorative: {
    label: 'Decorative shapes — starburst, blob, wave, dotted, zigzag, confetti, spiral, chevron, splash, ribbon',
    elements: {
      starburst_shape: { keywords: ['starburst', 'sparkle', 'burst shape'], defaultColor: '#f2b632', render: renderElStarburstShape },
      blob_shape: { keywords: ['blob', 'organic blob shape'], defaultColor: '#a855f7', render: renderElBlobShape },
      wave_shape: { keywords: ['wave', 'wavy line shape'], defaultColor: '#22c55e', render: renderElWaveShape },
      dotted_line_shape: { keywords: ['dotted line', 'ডটেড লাইন'], defaultColor: '#8a8f9c', render: renderElDottedLineShape },
      zigzag_shape: { keywords: ['zigzag', 'জিগজ্যাগ'], defaultColor: '#4f7df3', render: renderElZigzagShape },
      confetti_burst: { keywords: ['confetti', 'confetti burst', 'কনফেত্তি'], defaultColor: '#f2b632', render: renderElConfettiBurst },
      spiral_shape: { keywords: ['spiral', 'সর্পিল'], defaultColor: '#a855f7', render: renderElSpiralShape },
      burst_lines: { keywords: ['burst lines', 'action lines', 'লাইন বিস্ফোরণ'], defaultColor: '#e04f4f', render: renderElBurstLines },
      chevron_shape: { keywords: ['chevron', 'arrow band', 'শেভরন'], defaultColor: '#4f7df3', render: renderElChevronShape },
      dots_cluster: { keywords: ['dots cluster', 'halftone dots', 'ডট ক্লাস্টার'], defaultColor: '#8a8f9c', render: renderElDotsCluster },
      splash_shape: { keywords: ['splash', 'paint splash', 'স্প্ল্যাশ'], defaultColor: '#4f9de0', render: renderElSplashShape },
      ribbon_shape: { keywords: ['ribbon', 'decorative ribbon', 'রিবন'], defaultColor: '#f28ba8', render: renderElRibbonShape }
    }
  },
  backgrounds_scenic: {
    label: 'Full-bleed background/foreground compositions — wave stack, blob cluster, dot grid, low-poly, glow orb, mesh, triangles, scatter, stripes, wash',
    elements: {
      wave_band_stack: { keywords: ['wave band stack', 'paper cut waves'], defaultColor: '#e0c3fc', render: renderElWaveBandStack },
      blob_cluster: { keywords: ['blob cluster', 'pastel blob corners'], defaultColor: '#a8ddd0', render: renderElBlobCluster },
      dot_grid_texture: { keywords: ['dot grid', 'dotted texture'], defaultColor: '#ffffff', render: renderElDotGridTexture },
      low_poly_mosaic: { keywords: ['low poly', 'triangle mosaic'], defaultColor: '#5ad1e0', render: renderElLowPolyMosaic },
      radial_glow_orb: { keywords: ['glow', 'radial glow', 'light orb'], defaultColor: '#eaf6f6', render: renderElRadialGlowOrb },
      gradient_mesh: { keywords: ['gradient mesh', 'soft color mesh'], defaultColor: '#c8b6ff', render: renderElGradientMesh },
      triangle_grid: { keywords: ['triangle grid', 'geometric triangles'], defaultColor: '#f2b632', render: renderElTriangleGrid },
      circle_scatter: { keywords: ['circle scatter', 'bubble background'], defaultColor: '#4f9de0', render: renderElCircleScatter },
      diagonal_stripes: { keywords: ['diagonal stripes', 'slanted bands'], defaultColor: '#e0c3fc', render: renderElDiagonalStripes },
      soft_gradient_wash: { keywords: ['soft gradient', 'color wash', 'gentle gradient'], defaultColor: '#fbc2eb', render: renderElSoftGradientWash }
    }
  },
  people_parts: {
    label: 'People parts — hand pointing, eye, speech bubble, thought bubble, thumbs up, footprint, ear, smile',
    elements: {
      hand_pointing: { keywords: ['hand', 'pointing hand', 'হাত'], defaultColor: '#e8b48a', render: renderElHandPointing },
      eye: { keywords: ['eye', 'চোখ'], defaultColor: '#2b2b40', render: renderElEye },
      speech_bubble: { keywords: ['speech bubble', 'কথার বেলুন'], defaultColor: '#4f7df3', render: renderElSpeechBubble },
      thought_bubble: { keywords: ['thought bubble', 'চিন্তার বেলুন'], defaultColor: '#a855f7', render: renderElThoughtBubble },
      hand_thumbs_up: { keywords: ['thumbs up', 'like hand', 'লাইক হাত'], defaultColor: '#e8b48a', render: renderElHandThumbsUp },
      footprint: { keywords: ['footprint', 'foot step', 'পায়ের ছাপ'], defaultColor: '#4f9de0', render: renderElFootprint },
      ear: { keywords: ['ear', 'কান'], defaultColor: '#e8b48a', render: renderElEar },
      mouth_smile: { keywords: ['mouth', 'smile mouth', 'মুখ'], defaultColor: '#e04f4f', render: renderElMouthSmile }
    }
  },
  science: {
    label: 'Science — flask, magnet, atom, DNA, test tube, microscope, petri dish, thermometer',
    elements: {
      flask: { keywords: ['flask', 'beaker', 'ফ্লাস্ক'], defaultColor: '#4f9de0', render: renderElFlask },
      magnet: { keywords: ['magnet', 'চুম্বক'], defaultColor: '#e04f4f', render: renderElMagnet },
      atom_icon: { keywords: ['atom', 'পরমাণু'], defaultColor: '#4f7df3', render: renderElAtomIcon },
      dna_strand: { keywords: ['dna', 'ডিএনএ'], defaultColor: '#a855f7', render: renderElDnaStrand },
      test_tube: { keywords: ['test tube', 'টেস্ট টিউব'], defaultColor: '#4f9de0', render: renderElTestTube },
      microscope_science: { keywords: ['microscope', 'মাইক্রোস্কোপ'], defaultColor: '#4a5568', render: renderElMicroscopeScience },
      petri_dish: { keywords: ['petri dish', 'পেট্রি ডিশ'], defaultColor: '#bfe3f5', render: renderElPetriDish },
      thermometer_science: { keywords: ['lab thermometer', 'science thermometer'], defaultColor: '#e04f4f', render: renderElThermometerScience }
    }
  },
  finance: {
    label: 'Finance — coin, wallet, piggy bank, growth arrow, bank, credit card, receipt, money bag',
    elements: {
      coin: { keywords: ['coin', 'মুদ্রা'], defaultColor: '#f2b632', render: renderElCoin },
      wallet: { keywords: ['wallet', 'মানিব্যাগ'], defaultColor: '#6d4a2f', render: renderElWallet },
      piggy_bank: { keywords: ['piggy bank', 'সঞ্চয় বাক্স'], defaultColor: '#f28ba8', render: renderElPiggyBank },
      growth_arrow: { keywords: ['growth arrow', 'প্রবৃদ্ধি তীর'], defaultColor: '#22c55e', render: renderElGrowthArrow },
      bank_building: { keywords: ['bank', 'ব্যাংক'], defaultColor: '#4a5568', render: renderElBankBuilding },
      credit_card: { keywords: ['credit card', 'ক্রেডিট কার্ড'], defaultColor: '#4f7df3', render: renderElCreditCard },
      receipt: { keywords: ['receipt', 'bill', 'রসিদ'], defaultColor: '#ffffff', render: renderElReceipt },
      money_bag: { keywords: ['money bag', 'টাকার ব্যাগ'], defaultColor: '#d9a441', render: renderElMoneyBag }
    }
  },
  health: {
    label: 'Health — heart, pill, stethoscope, bandage, syringe, first aid, wheelchair, thermometer',
    elements: {
      heart_icon: { keywords: ['heart', 'হৃদয়'], defaultColor: '#e04f4f', render: renderElHeartIcon },
      pill: { keywords: ['pill', 'capsule', 'ওষুধ'], defaultColor: '#4f9de0', render: renderElPill },
      stethoscope: { keywords: ['stethoscope', 'স্টেথোস্কোপ'], defaultColor: '#4a5568', render: renderElStethoscope },
      bandage: { keywords: ['bandage', 'ব্যান্ডেজ'], defaultColor: '#f2d9b8', render: renderElBandage },
      syringe: { keywords: ['syringe', 'injection', 'সিরিঞ্জ'], defaultColor: '#8a8f9c', render: renderElSyringe },
      thermometer_health: { keywords: ['medical thermometer', 'জ্বরের থার্মোমিটার'], defaultColor: '#e04f4f', render: renderElThermometerHealth },
      first_aid_kit: { keywords: ['first aid kit', 'প্রাথমিক চিকিৎসা'], defaultColor: '#e04f4f', render: renderElFirstAidKit },
      wheelchair: { keywords: ['wheelchair', 'হুইলচেয়ার'], defaultColor: '#4a5568', render: renderElWheelchair }
    }
  },
  food: {
    label: 'Food — coffee cup, apple, pizza, burger, ice cream, bread',
    elements: {
      coffee_cup: { keywords: ['coffee', 'coffee cup', 'কফি'], defaultColor: '#6d4a2f', render: renderElCoffeeCup },
      apple_fruit: { keywords: ['apple', 'আপেল'], defaultColor: '#e04f4f', render: renderElAppleFruit },
      pizza_slice: { keywords: ['pizza', 'পিৎজা'], defaultColor: '#f5d76e', render: renderElPizzaSlice },
      burger: { keywords: ['burger', 'hamburger', 'বার্গার'], defaultColor: '#d9a441', render: renderElBurger },
      ice_cream: { keywords: ['ice cream', 'আইসক্রিম'], defaultColor: '#f28ba8', render: renderElIceCream },
      bread_loaf: { keywords: ['bread', 'loaf', 'রুটি'], defaultColor: '#d9a441', render: renderElBreadLoaf }
    }
  },
  travel: {
    label: 'Travel — airplane, suitcase, map pin, globe, compass, camera, passport, beach umbrella',
    elements: {
      airplane: { keywords: ['airplane', 'plane', 'উড়োজাহাজ'], defaultColor: '#4a5568', render: renderElAirplane },
      suitcase: { keywords: ['suitcase', 'luggage', 'স্যুটকেস'], defaultColor: '#4f7df3', render: renderElSuitcase },
      map_pin: { keywords: ['map pin', 'location pin', 'ম্যাপ পিন'], defaultColor: '#e04f4f', render: renderElMapPin },
      globe: { keywords: ['globe', 'world globe', 'গ্লোব'], defaultColor: '#2f7d6a', render: renderElGlobe },
      compass: { keywords: ['compass', 'দিকনির্ণয়'], defaultColor: '#d9a441', render: renderElCompass },
      camera_travel: { keywords: ['travel camera', 'photo camera'], defaultColor: '#2b2b40', render: renderElCameraTravel },
      passport: { keywords: ['passport', 'পাসপোর্ট'], defaultColor: '#4a2c1e', render: renderElPassport },
      beach_umbrella: { keywords: ['beach umbrella', 'samar', 'সৈকত ছাতা'], defaultColor: '#e04f4f', render: renderElBeachUmbrella }
    }
  },
  nature_plants: {
    label: 'Nature & plants — leaf, tree, flower, cactus, mushroom, fern, vine, sunflower',
    elements: {
      leaf: { keywords: ['leaf', 'পাতা'], defaultColor: '#4f9d5c', render: renderElLeaf },
      tree_small: { keywords: ['tree', 'গাছ'], defaultColor: '#2f7d4a', render: renderElTreeSmall },
      flower: { keywords: ['flower', 'ফুল'], defaultColor: '#f28ba8', render: renderElFlower },
      cactus: { keywords: ['cactus', 'ক্যাকটাস'], defaultColor: '#2f7d4a', render: renderElCactus },
      mushroom: { keywords: ['mushroom', 'মাশরুম'], defaultColor: '#e04f4f', render: renderElMushroom },
      fern: { keywords: ['fern', 'ফার্ন'], defaultColor: '#4f9d5c', render: renderElFern },
      vine: { keywords: ['vine', 'লতা'], defaultColor: '#2f7d4a', render: renderElVine },
      sunflower: { keywords: ['sunflower', 'সূর্যমুখী'], defaultColor: '#f2b632', render: renderElSunflower }
    }
  },
  arrows_flow: {
    label: 'Arrows & flow — up, down, curved, loop, left, diagonal, split, merge',
    elements: {
      arrow_up: { keywords: ['arrow up', 'উপরের তীর'], defaultColor: '#4f7df3', render: renderElArrowUp },
      arrow_down: { keywords: ['arrow down', 'নিচের তীর'], defaultColor: '#e04f4f', render: renderElArrowDown },
      arrow_curved: { keywords: ['curved arrow', 'বাঁকা তীর'], defaultColor: '#22c55e', render: renderElArrowCurved },
      loop_arrow: { keywords: ['loop arrow', 'লুপ তীর'], defaultColor: '#4f7df3', render: renderElLoopArrow },
      arrow_left: { keywords: ['arrow left', 'বাম তীর'], defaultColor: '#4f7df3', render: renderElArrowLeft },
      arrow_diagonal: { keywords: ['diagonal arrow', 'তির্যক তীর'], defaultColor: '#a855f7', render: renderElArrowDiagonal },
      split_arrow: { keywords: ['split arrow', 'branching arrow', 'শাখা তীর'], defaultColor: '#22c55e', render: renderElSplitArrow },
      merge_arrow: { keywords: ['merge arrow', 'converge arrow', 'মিলন তীর'], defaultColor: '#f2b632', render: renderElMergeArrow }
    }
  },
  communication: {
    label: 'Communication — envelope, phone call, bell, megaphone, chat, tower, radio, dish',
    elements: {
      envelope: { keywords: ['envelope', 'mail', 'খাম'], defaultColor: '#4f7df3', render: renderElEnvelope },
      phone_call: { keywords: ['phone call', 'ফোন কল'], defaultColor: '#22c55e', render: renderElPhoneCall },
      bell_notification: { keywords: ['bell', 'notification', 'ঘণ্টা'], defaultColor: '#f2b632', render: renderElBellNotification },
      megaphone: { keywords: ['megaphone', 'মেগাফোন'], defaultColor: '#e04f4f', render: renderElMegaphone },
      chat_icon: { keywords: ['chat icon', 'message icon', 'চ্যাট আইকন'], defaultColor: '#4f7df3', render: renderElChatIcon },
      signal_tower: { keywords: ['signal tower', 'antenna tower', 'সিগন্যাল টাওয়ার'], defaultColor: '#4a5568', render: renderElSignalTower },
      radio: { keywords: ['radio', 'রেডিও'], defaultColor: '#d9a441', render: renderElRadio },
      satellite_dish: { keywords: ['satellite dish', 'dish antenna', 'ডিশ অ্যান্টেনা'], defaultColor: '#c7d0dc', render: renderElSatelliteDish }
    }
  },
  awards: {
    label: 'Awards — trophy, medal, ribbon badge, certificate, crown, laurel, prize ribbon, achievement',
    elements: {
      trophy: { keywords: ['trophy', 'ট্রফি'], defaultColor: '#f2b632', render: renderElTrophy },
      medal: { keywords: ['medal', 'পদক'], defaultColor: '#f2b632', render: renderElMedal },
      ribbon_badge: { keywords: ['ribbon badge', 'রিবন ব্যাজ'], defaultColor: '#4f7df3', render: renderElRibbonBadge },
      certificate_icon: { keywords: ['certificate', 'সার্টিফিকেট'], defaultColor: '#4f7df3', render: renderElCertificateIcon },
      crown: { keywords: ['crown', 'মুকুট'], defaultColor: '#f2b632', render: renderElCrown },
      star_laurel: { keywords: ['laurel wreath', 'star laurel', 'লরেল'], defaultColor: '#22c55e', render: renderElStarLaurel },
      prize_ribbon: { keywords: ['prize ribbon', 'award ribbon', 'পুরস্কার ফিতা'], defaultColor: '#e04f4f', render: renderElPrizeRibbon },
      achievement_badge: { keywords: ['achievement badge', 'badge', 'অ্যাচিভমেন্ট ব্যাজ'], defaultColor: '#f2b632', render: renderElAchievementBadge }
    }
  },
  sports: {
    label: 'Sports — soccer, basketball, tennis, whistle, shoe, baseball, golf, goggles, boxing',
    elements: {
      soccer_ball: { keywords: ['soccer ball', 'football', 'ফুটবল'], defaultColor: '#2b2b40', render: renderElSoccerBall },
      basketball: { keywords: ['basketball', 'বাস্কেটবল'], defaultColor: '#d9734e', render: renderElBasketball },
      tennis_racket: { keywords: ['tennis racket', 'টেনিস র‍্যাকেট'], defaultColor: '#8a8f9c', render: renderElTennisRacket },
      whistle: { keywords: ['whistle', 'বাঁশি'], defaultColor: '#f2b632', render: renderElWhistle },
      running_shoe: { keywords: ['running shoe', 'জুতা'], defaultColor: '#e04f4f', render: renderElRunningShoe },
      baseball: { keywords: ['baseball', 'বেসবল'], defaultColor: '#ffffff', render: renderElBaseball },
      tennis_ball: { keywords: ['tennis ball', 'টেনিস বল'], defaultColor: '#c9e04f', render: renderElTennisBall },
      golf_club: { keywords: ['golf club', 'গলফ ক্লাব'], defaultColor: '#8a8f9c', render: renderElGolfClub },
      swimming_goggles: { keywords: ['goggles', 'swim goggles', 'সাঁতারের চশমা'], defaultColor: '#4f9de0', render: renderElSwimmingGoggles },
      boxing_glove: { keywords: ['boxing glove', 'বক্সিং গ্লাভস'], defaultColor: '#e04f4f', render: renderElBoxingGlove }
    }
  },
  music: {
    label: 'Music — note, guitar, drum, piano, mic, violin, trumpet, saxophone, stand, speaker',
    elements: {
      musical_note: { keywords: ['musical note', 'সুরের নোট'], defaultColor: '#2b2b40', render: renderElMusicalNote },
      guitar: { keywords: ['guitar', 'গিটার'], defaultColor: '#d9a441', render: renderElGuitar },
      drum: { keywords: ['drum', 'ঢোল'], defaultColor: '#e04f4f', render: renderElDrum },
      piano_keys: { keywords: ['piano', 'পিয়ানো'], defaultColor: '#2b2b40', render: renderElPianoKeys },
      microphone: { keywords: ['microphone', 'মাইক্রোফোন'], defaultColor: '#4a5568', render: renderElMicrophone },
      violin: { keywords: ['violin', 'বেহালা'], defaultColor: '#8a4a2f', render: renderElViolin },
      trumpet: { keywords: ['trumpet', 'ট্রাম্পেট'], defaultColor: '#f2b632', render: renderElTrumpet },
      saxophone: { keywords: ['saxophone', 'স্যাক্সোফোন'], defaultColor: '#d9a441', render: renderElSaxophone },
      music_stand: { keywords: ['music stand', 'note stand', 'নোট স্ট্যান্ড'], defaultColor: '#4a5568', render: renderElMusicStand },
      speaker: { keywords: ['speaker', 'audio speaker', 'স্পিকার'], defaultColor: '#2b2b40', render: renderElSpeaker }
    }
  },
  kitchen: {
    label: 'Kitchen — chef hat, pot, cutlery, kettle, board, rolling pin, blender, toaster, oven, sink',
    elements: {
      chef_hat: { keywords: ['chef hat', 'শেফ টুপি'], defaultColor: '#ffffff', render: renderElChefHat },
      cooking_pot: { keywords: ['cooking pot', 'pot', 'হাঁড়ি'], defaultColor: '#4a5568', render: renderElCookingPot },
      fork_knife: { keywords: ['fork and knife', 'ছুরি কাঁটা'], defaultColor: '#8a8f9c', render: renderElForkKnife },
      kettle: { keywords: ['kettle', 'কেটলি'], defaultColor: '#4a5568', render: renderElKettle },
      cutting_board: { keywords: ['cutting board', 'কাটিং বোর্ড'], defaultColor: '#d9a441', render: renderElCuttingBoard },
      rolling_pin: { keywords: ['rolling pin', 'বেলুন কাঠি'], defaultColor: '#d9a441', render: renderElRollingPin },
      blender: { keywords: ['blender', 'mixer', 'ব্লেন্ডার'], defaultColor: '#4a5568', render: renderElBlender },
      toaster: { keywords: ['toaster', 'টোস্টার'], defaultColor: '#c7d0dc', render: renderElToaster },
      microwave: { keywords: ['microwave', 'microwave oven', 'মাইক্রোওয়েভ'], defaultColor: '#4a5568', render: renderElMicrowave },
      refrigerator: { keywords: ['refrigerator', 'fridge', 'ফ্রিজ'], defaultColor: '#c7d0dc', render: renderElRefrigerator },
      oven: { keywords: ['oven', 'চুলা'], defaultColor: '#4a5568', render: renderElOven },
      sink: { keywords: ['sink', 'kitchen sink', 'সিঙ্ক'], defaultColor: '#c7d0dc', render: renderElSink }
    }
  },
  security: {
    label: 'Security — padlock, shield, fingerprint, CCTV, key card, alarm, safe, door lock, gate, warning',
    elements: {
      padlock: { keywords: ['padlock', 'তালা'], defaultColor: '#f2b632', render: renderElPadlock },
      shield_icon: { keywords: ['shield', 'ঢাল'], defaultColor: '#4f7df3', render: renderElShieldIcon },
      fingerprint: { keywords: ['fingerprint', 'আঙুলের ছাপ'], defaultColor: '#4a5568', render: renderElFingerprint },
      cctv_camera: { keywords: ['cctv', 'security camera', 'সিসিটিভি'], defaultColor: '#2b2b40', render: renderElCctvCamera },
      key_card: { keywords: ['key card', 'access card', 'কী কার্ড'], defaultColor: '#4f7df3', render: renderElKeyCard },
      alarm_bell: { keywords: ['alarm bell', 'security alarm', 'অ্যালার্ম'], defaultColor: '#e04f4f', render: renderElAlarmBell },
      safe_box: { keywords: ['safe box', 'vault', 'সিন্দুক'], defaultColor: '#4a5568', render: renderElSafeBox },
      door_lock: { keywords: ['door lock', 'deadbolt', 'দরজার তালা'], defaultColor: '#f2b632', render: renderElDoorLock },
      security_gate: { keywords: ['security gate', 'barrier gate', 'গেট'], defaultColor: '#c7d0dc', render: renderElSecurityGate },
      warning_sign: { keywords: ['warning sign', 'alert sign', 'সতর্কতা চিহ্ন'], defaultColor: '#f2b632', render: renderElWarningSign }
    }
  },
  time_calendar: {
    label: 'Time & calendar — calendar, hourglass, stopwatch, alarm, wall clock, digital, sand timer, tower',
    elements: {
      calendar_page: { keywords: ['calendar', 'ক্যালেন্ডার'], defaultColor: '#e04f4f', render: renderElCalendarPage },
      hourglass: { keywords: ['hourglass', 'ঘণ্টাবালি'], defaultColor: '#d9a441', render: renderElHourglass },
      stopwatch: { keywords: ['stopwatch', 'স্টপওয়াচ'], defaultColor: '#3f6fb0', render: renderElStopwatch },
      alarm_clock: { keywords: ['alarm clock', 'অ্যালার্ম ঘড়ি'], defaultColor: '#e04f4f', render: renderElAlarmClock },
      wall_clock: { keywords: ['wall clock', 'দেয়াল ঘড়ি'], defaultColor: '#6d4a2f', render: renderElWallClock },
      digital_clock: { keywords: ['digital clock', 'ডিজিটাল ঘড়ি'], defaultColor: '#2b2b40', render: renderElDigitalClock },
      sand_timer: { keywords: ['sand timer', 'egg timer', 'বালু ঘড়ি'], defaultColor: '#d9a441', render: renderElSandTimer },
      clock_tower: { keywords: ['clock tower', 'ঘড়ি টাওয়ার'], defaultColor: '#b3432f', render: renderElClockTower }
    }
  },
  buildings_infra: {
    label: 'Buildings & infrastructure — bridge, factory, skyscraper, crane, traffic light, lamp, windmill, dam, lighthouse',
    elements: {
      bridge: { keywords: ['bridge', 'সেতু'], defaultColor: '#4a5568', render: renderElBridge },
      factory: { keywords: ['factory', 'কারখানা'], defaultColor: '#7d8ba1', render: renderElFactory },
      skyscraper: { keywords: ['skyscraper', 'আকাশচুম্বী ভবন'], defaultColor: '#4f7df3', render: renderElSkyscraper },
      crane: { keywords: ['crane', 'ক্রেন'], defaultColor: '#f2b632', render: renderElCrane },
      traffic_light: { keywords: ['traffic light', 'ট্রাফিক লাইট'], defaultColor: '#2b2b40', render: renderElTrafficLight },
      street_lamp: { keywords: ['street lamp', 'রাস্তার বাতি'], defaultColor: '#4a5568', render: renderElStreetLamp },
      windmill: { keywords: ['windmill', 'বায়ুকল'], defaultColor: '#c7d0dc', render: renderElWindmill },
      water_tower: { keywords: ['water tower', 'পানির টাওয়ার'], defaultColor: '#8a8f9c', render: renderElWaterTower },
      solar_panel: { keywords: ['solar panel', 'সোলার প্যানেল'], defaultColor: '#4f7df3', render: renderElSolarPanel },
      dam: { keywords: ['dam', 'বাঁধ'], defaultColor: '#8a8f9c', render: renderElDam },
      lighthouse: { keywords: ['lighthouse', 'বাতিঘর'], defaultColor: '#e04f4f', render: renderElLighthouse },
      radio_tower: { keywords: ['radio tower', 'antenna tower', 'রেডিও টাওয়ার'], defaultColor: '#e04f4f', render: renderElRadioTower }
    }
  },
  vehicles: {
    label: 'Vehicles — car, bicycle, bus, motorcycle, train, boat, van, helicopter, submarine, truck, ambulance',
    elements: {
      car: { keywords: ['car', 'গাড়ি'], defaultColor: '#e04f4f', render: renderElCar },
      bicycle: { keywords: ['bicycle', 'সাইকেল'], defaultColor: '#2b2b40', render: renderElBicycle },
      bus: { keywords: ['bus', 'বাস'], defaultColor: '#f2b632', render: renderElBus },
      motorcycle: { keywords: ['motorcycle', 'মোটরসাইকেল'], defaultColor: '#4a5568', render: renderElMotorcycle },
      train: { keywords: ['train', 'ট্রেন'], defaultColor: '#4a5568', render: renderElTrain },
      boat: { keywords: ['boat', 'নৌকা'], defaultColor: '#4f7df3', render: renderElBoat },
      delivery_van: { keywords: ['delivery van', 'ডেলিভারি ভ্যান'], defaultColor: '#f2b632', render: renderElDeliveryVan },
      helicopter: { keywords: ['helicopter', 'হেলিকপ্টার'], defaultColor: '#4f7df3', render: renderElHelicopter },
      submarine: { keywords: ['submarine', 'সাবমেরিন'], defaultColor: '#4a5568', render: renderElSubmarine },
      scooter: { keywords: ['scooter', 'মোটর স্কুটার'], defaultColor: '#22c55e', render: renderElScooter },
      truck: { keywords: ['truck', 'ট্রাক'], defaultColor: '#4f7df3', render: renderElTruck },
      ferry: { keywords: ['ferry', 'ফেরি'], defaultColor: '#4a5568', render: renderElFerry },
      ambulance: { keywords: ['ambulance', 'অ্যাম্বুলেন্স'], defaultColor: '#ffffff', render: renderElAmbulance },
      fire_truck: { keywords: ['fire truck', 'দমকল গাড়ি'], defaultColor: '#e04f4f', render: renderElFireTruck }
    }
  },
  office: {
    label: 'Office — briefcase, ID badge, folder, screen, clipboard, sticky note, desk lamp, chair, cabinet, whiteboard',
    elements: {
      briefcase: { keywords: ['briefcase', 'ব্রিফকেস'], defaultColor: '#6d4a2f', render: renderElBriefcase },
      id_badge: { keywords: ['id badge', 'পরিচয়পত্র'], defaultColor: '#4f7df3', render: renderElIdBadge },
      folder_stack: { keywords: ['folder', 'ফোল্ডার'], defaultColor: '#f2b632', render: renderElFolderStack },
      presentation_screen: { keywords: ['presentation screen', 'উপস্থাপনা স্ক্রিন'], defaultColor: '#4a5568', render: renderElPresentationScreen },
      clipboard: { keywords: ['clipboard', 'ক্লিপবোর্ড'], defaultColor: '#8a8f9c', render: renderElClipboard },
      sticky_note: { keywords: ['sticky note', 'স্টিকি নোট'], defaultColor: '#f5d76e', render: renderElStickyNote },
      desk_lamp: { keywords: ['desk lamp', 'ডেস্ক ল্যাম্প'], defaultColor: '#4a5568', render: renderElDeskLamp },
      desk_chair: { keywords: ['desk chair', 'office chair', 'অফিস চেয়ার'], defaultColor: '#2b2b40', render: renderElDeskChair },
      filing_cabinet: { keywords: ['filing cabinet', 'ফাইল ক্যাবিনেট'], defaultColor: '#8a8f9c', render: renderElFilingCabinet },
      whiteboard: { keywords: ['whiteboard', 'হোয়াইটবোর্ড'], defaultColor: '#ffffff', render: renderElWhiteboard },
      pen_holder: { keywords: ['pen holder', 'পেন হোল্ডার'], defaultColor: '#4f7df3', render: renderElPenHolder },
      document_stack: { keywords: ['document stack', 'papers', 'ডকুমেন্ট স্ট্যাক'], defaultColor: '#ffffff', render: renderElDocumentStack },
      office_plant: { keywords: ['office plant', 'desk plant', 'অফিস গাছ'], defaultColor: '#4f9d5c', render: renderElOfficePlant },
      paper_tray: { keywords: ['paper tray', 'document tray', 'পেপার ট্রে'], defaultColor: '#2b2b40', render: renderElPaperTray }
    }
  },
  baby_kids: {
    label: 'Baby & kids — bottle, teddy, blocks, pacifier, rattle, stroller, crib, high chair, monitor, rocking horse',
    elements: {
      baby_bottle: { keywords: ['baby bottle', 'দুধের বোতল'], defaultColor: '#bfe3f5', render: renderElBabyBottle },
      teddy_bear: { keywords: ['teddy bear', 'টেডি বিয়ার'], defaultColor: '#d9a441', render: renderElTeddyBear },
      building_blocks: { keywords: ['building blocks', 'ব্লক খেলনা'], defaultColor: '#e04f4f', render: renderElBuildingBlocks },
      pacifier: { keywords: ['pacifier', 'চুষি'], defaultColor: '#f28ba8', render: renderElPacifier },
      rattle_toy: { keywords: ['rattle', 'ঝুনঝুনি'], defaultColor: '#f2b632', render: renderElRattleToy },
      stroller: { keywords: ['stroller', 'pram', 'ঠেলাগাড়ি'], defaultColor: '#4f7df3', render: renderElStroller },
      baby_crib: { keywords: ['baby crib', 'cot', 'শিশুর খাট'], defaultColor: '#f2d9b8', render: renderElBabyCrib },
      high_chair: { keywords: ['high chair', 'baby chair', 'শিশু চেয়ার'], defaultColor: '#4f7df3', render: renderElHighChair },
      baby_monitor: { keywords: ['baby monitor', 'শিশু মনিটর'], defaultColor: '#c7d0dc', render: renderElBabyMonitor },
      rocking_horse: { keywords: ['rocking horse', 'দোলনা ঘোড়া'], defaultColor: '#d9a441', render: renderElRockingHorse },
      toy_drum: { keywords: ['toy drum', 'খেলনা ঢোল'], defaultColor: '#e04f4f', render: renderElToyDrum },
      picture_book: { keywords: ['picture book', 'ছবির বই'], defaultColor: '#4f7df3', render: renderElPictureBook }
    }
  },
  agriculture: {
    label: 'Agriculture — tractor, wheat, watering can, barn, hat, pipe, seed, hay, shovel, greenhouse, scarecrow',
    elements: {
      tractor: { keywords: ['tractor', 'ট্রাক্টর'], defaultColor: '#22c55e', render: renderElTractor },
      wheat_stalk: { keywords: ['wheat', 'গম'], defaultColor: '#f2b632', render: renderElWheatStalk },
      watering_can: { keywords: ['watering can', 'পানি দেওয়ার কৌটা'], defaultColor: '#4f9de0', render: renderElWateringCan },
      barn: { keywords: ['barn', 'গোলাঘর'], defaultColor: '#e04f4f', render: renderElBarn },
      farmer_hat: { keywords: ['farmer hat', 'কৃষকের টুপি'], defaultColor: '#d9a441', render: renderElFarmerHat },
      irrigation_pipe: { keywords: ['irrigation pipe', 'সেচ পাইপ'], defaultColor: '#8a8f9c', render: renderElIrrigationPipe },
      seed_packet: { keywords: ['seed packet', 'বীজের প্যাকেট'], defaultColor: '#d9a441', render: renderElSeedPacket },
      hay_bale: { keywords: ['hay bale', 'খড়ের গাদা'], defaultColor: '#f2b632', render: renderElHayBale },
      shovel: { keywords: ['shovel', 'কোদাল'], defaultColor: '#8a8f9c', render: renderElShovel },
      pitchfork: { keywords: ['pitchfork', 'খুন্তি'], defaultColor: '#8a8f9c', render: renderElPitchfork },
      greenhouse: { keywords: ['greenhouse', 'গ্রিনহাউস'], defaultColor: '#bfe3f5', render: renderElGreenhouse },
      scarecrow: { keywords: ['scarecrow', 'কাকতাড়ুয়া'], defaultColor: '#d9a441', render: renderElScarecrow }
    }
  },
  space: {
    label: 'Space — rocket, planet, satellite, helmet, lander, stars, telescope, station, alien, UFO',
    elements: {
      rocket: { keywords: ['rocket', 'রকেট'], defaultColor: '#e04f4f', render: renderElRocket },
      planet_ringed: { keywords: ['planet', 'গ্রহ'], defaultColor: '#d9a441', render: renderElPlanetRinged },
      satellite: { keywords: ['satellite', 'স্যাটেলাইট'], defaultColor: '#8a8f9c', render: renderElSatellite },
      astronaut_helmet: { keywords: ['astronaut helmet', 'নভোচারীর হেলমেট'], defaultColor: '#e8ecf5', render: renderElAstronautHelmet },
      moon_lander: { keywords: ['moon lander', 'চন্দ্রযান'], defaultColor: '#f2b632', render: renderElMoonLander },
      star_field: { keywords: ['star field', 'তারকাখচিত আকাশ'], defaultColor: '#f7c948', render: renderElStarField },
      telescope: { keywords: ['telescope', 'দূরবীন'], defaultColor: '#4a5568', render: renderElTelescope },
      comet_space: { keywords: ['space comet', 'ধূমকেতু'], defaultColor: '#bfe3f5', render: renderElCometSpace },
      space_station: { keywords: ['space station', 'মহাকাশ স্টেশন'], defaultColor: '#c7d0dc', render: renderElSpaceStation },
      alien: { keywords: ['alien', 'এলিয়েন'], defaultColor: '#22c55e', render: renderElAlien },
      ufo: { keywords: ['ufo', 'flying saucer', 'ইউএফও'], defaultColor: '#8a8f9c', render: renderElUfo },
      constellation: { keywords: ['constellation', 'তারামণ্ডল'], defaultColor: '#f7c948', render: renderElConstellation }
    }
  },
  emotions_faces: {
    label: 'Emotions — happy, sad, surprised, angry, love, sleepy, wink, cool, confused, crying, laughing, neutral',
    elements: {
      face_happy: { keywords: ['happy face', 'হাসিমুখ'], defaultColor: '#f2b632', render: renderElFaceHappy },
      face_sad: { keywords: ['sad face', 'মন খারাপ মুখ'], defaultColor: '#4f9de0', render: renderElFaceSad },
      face_surprised: { keywords: ['surprised face', 'অবাক মুখ'], defaultColor: '#f2b632', render: renderElFaceSurprised },
      face_angry: { keywords: ['angry face', 'রাগান্বিত মুখ'], defaultColor: '#e04f4f', render: renderElFaceAngry },
      face_love: { keywords: ['love face', 'ভালোবাসার মুখ'], defaultColor: '#f28ba8', render: renderElFaceLove },
      face_sleepy: { keywords: ['sleepy face', 'ঘুমন্ত মুখ'], defaultColor: '#a855f7', render: renderElFaceSleepy },
      face_wink: { keywords: ['wink face', 'চোখ টেপা মুখ'], defaultColor: '#f2b632', render: renderElFaceWink },
      face_cool: { keywords: ['cool face', 'sunglasses face', 'ঠান্ডা মুখ'], defaultColor: '#f2b632', render: renderElFaceCool },
      face_confused: { keywords: ['confused face', 'বিভ্রান্ত মুখ'], defaultColor: '#a855f7', render: renderElFaceConfused },
      face_crying: { keywords: ['crying face', 'কাঁদা মুখ'], defaultColor: '#4f9de0', render: renderElFaceCrying },
      face_laughing: { keywords: ['laughing face', 'হাসতে থাকা মুখ'], defaultColor: '#f2b632', render: renderElFaceLaughing },
      face_neutral: { keywords: ['neutral face', 'নিরপেক্ষ মুখ'], defaultColor: '#c7d0dc', render: renderElFaceNeutral }
    }
  },
  celebrations: {
    label: 'Celebrations — birthday cake, party hat, gift, fireworks, balloons, confetti cannon, popper, cake slice',
    elements: {
      birthday_cake: { keywords: ['birthday cake', 'জন্মদিনের কেক'], defaultColor: '#f28ba8', render: renderElBirthdayCake },
      party_hat: { keywords: ['party hat', 'পার্টি টুপি'], defaultColor: '#a855f7', render: renderElPartyHat },
      gift_box: { keywords: ['gift box', 'উপহার বাক্স'], defaultColor: '#e04f4f', render: renderElGiftBox },
      fireworks: { keywords: ['fireworks', 'আতশবাজি'], defaultColor: '#f2b632', render: renderElFireworks },
      balloon_bunch: { keywords: ['balloons', 'balloon bunch', 'বেলুন'], defaultColor: '#e04f4f', render: renderElBalloonBunch },
      confetti_cannon: { keywords: ['confetti cannon', 'confetti popper', 'কনফেত্তি কামান'], defaultColor: '#f2b632', render: renderElConfettiCannon },
      party_popper: { keywords: ['party popper', 'পার্টি পপার'], defaultColor: '#a855f7', render: renderElPartyPopper },
      cake_slice: { keywords: ['cake slice', 'slice of cake', 'কেকের টুকরা'], defaultColor: '#f28ba8', render: renderElCakeSlice }
    }
  },
  religion_culture: {
    label: 'Religion & culture — prayer beads, lantern, festival flag, incense, mat, temple dome',
    elements: {
      prayer_beads: { keywords: ['prayer beads', 'জপমালা'], defaultColor: '#4a5568', render: renderElPrayerBeads },
      lantern: { keywords: ['lantern', 'ল্যান্টার্ন'], defaultColor: '#f2b632', render: renderElLantern },
      festival_flag: { keywords: ['festival flag', 'পতাকা'], defaultColor: '#e04f4f', render: renderElFestivalFlag },
      incense_stick: { keywords: ['incense', 'incense stick', 'ধূপ'], defaultColor: '#8a4a2f', render: renderElIncenseStick },
      prayer_mat: { keywords: ['prayer mat', 'নামাজের মাদুর'], defaultColor: '#2f7d6a', render: renderElPrayerMat },
      temple_dome: { keywords: ['temple dome', 'dome building', 'মন্দির গম্বুজ'], defaultColor: '#f2b632', render: renderElTempleDome }
    }
  },
  insects_small_creatures: {
    label: 'Insects & small creatures — butterfly, ladybug, ant, bee, spider, snail',
    elements: {
      butterfly: { keywords: ['butterfly', 'প্রজাপতি'], defaultColor: '#a855f7', render: renderElButterfly },
      ladybug: { keywords: ['ladybug', 'লেডিবাগ'], defaultColor: '#e04f4f', render: renderElLadybug },
      ant: { keywords: ['ant', 'পিঁপড়া'], defaultColor: '#2b2b40', render: renderElAnt },
      bee: { keywords: ['bee', 'মৌমাছি'], defaultColor: '#f2b632', render: renderElBee },
      spider: { keywords: ['spider', 'মাকড়সা'], defaultColor: '#2b2b40', render: renderElSpider },
      snail: { keywords: ['snail', 'শামুক'], defaultColor: '#d9a441', render: renderElSnail }
    }
  },
  hobbies_crafts: {
    label: 'Hobbies & crafts — paintbrush, yarn, easel, knitting, needle, tripod',
    elements: {
      paintbrush: { keywords: ['paintbrush', 'তুলি'], defaultColor: '#4f7df3', render: renderElPaintbrush },
      yarn_ball: { keywords: ['yarn ball', 'সুতার বল'], defaultColor: '#e04f4f', render: renderElYarnBall },
      easel: { keywords: ['easel', 'ইজেল'], defaultColor: '#6d4a2f', render: renderElEasel },
      knitting_needles: { keywords: ['knitting needles', 'বুনন সূচ'], defaultColor: '#8a8f9c', render: renderElKnittingNeedles },
      sewing_needle: { keywords: ['sewing needle', 'সূচ'], defaultColor: '#c7d0dc', render: renderElSewingNeedle },
      camera_tripod: { keywords: ['camera tripod', 'tripod', 'ট্রাইপড'], defaultColor: '#2b2b40', render: renderElCameraTripod }
    }
  },
  marine_life: {
    label: 'Marine life — fish, seashell, wave crest, octopus, anchor, coral',
    elements: {
      fish: { keywords: ['fish', 'মাছ'], defaultColor: '#4f9de0', render: renderElFish },
      seashell: { keywords: ['seashell', 'ঝিনুক'], defaultColor: '#f2d9b8', render: renderElSeashell },
      wave_crest: { keywords: ['ocean wave', 'সমুদ্রের ঢেউ'], defaultColor: '#4f9de0', render: renderElWaveCrest },
      octopus: { keywords: ['octopus', 'অক্টোপাস'], defaultColor: '#a855f7', render: renderElOctopus },
      anchor: { keywords: ['anchor', 'নোঙর'], defaultColor: '#4a5568', render: renderElAnchor },
      coral_branch: { keywords: ['coral', 'coral branch', 'প্রবাল'], defaultColor: '#f28ba8', render: renderElCoralBranch }
    }
  },
  seasons: {
    label: 'Seasons — autumn leaf, snowman, sprout, scarf, rain boots, summer sun',
    elements: {
      autumn_leaf: { keywords: ['autumn leaf', 'শরতের পাতা'], defaultColor: '#d9734e', render: renderElAutumnLeaf },
      snowman: { keywords: ['snowman', 'তুষার মানব'], defaultColor: '#ffffff', render: renderElSnowman },
      spring_sprout: { keywords: ['sprout', 'অঙ্কুর'], defaultColor: '#4f9d5c', render: renderElSpringSprout },
      winter_scarf: { keywords: ['scarf', 'winter scarf', 'শীতের স্কার্ফ'], defaultColor: '#e04f4f', render: renderElWinterScarf },
      rain_boots: { keywords: ['rain boots', 'wellies', 'বৃষ্টির বুট'], defaultColor: '#f2b632', render: renderElRainBoots },
      summer_sun: { keywords: ['summer sun', 'বড় সূর্য'], defaultColor: '#f5a623', render: renderElSummerSun }
    }
  }
};

// ===== LOOKUP HELPER =====
function _elFindElement(id) {
  const key = String(id || '').trim().toLowerCase();
  for (const catKey in ELEMENT_CATEGORIES) {
    const cat = ELEMENT_CATEGORIES[catKey];
    if (cat.elements[key]) return { categoryKey: catKey, category: cat, element: cat.elements[key], id: key };
  }
  return null;
}

// ========================================================================
// RENDERERS — every renderer returns ONLY the inner markup for a
// 0..100 x 0..100 box. No <svg>/<g> wrapper.
// ========================================================================

function _elStarPoints(cx, cy, spikes, outerR, innerR) {
  let pts = [];
  const step = Math.PI / spikes;
  let rot = -Math.PI / 2;
  for (let i = 0; i < spikes; i++) {
    pts.push(`${(cx + Math.cos(rot) * outerR).toFixed(1)},${(cy + Math.sin(rot) * outerR).toFixed(1)}`);
    rot += step;
    pts.push(`${(cx + Math.cos(rot) * innerR).toFixed(1)},${(cy + Math.sin(rot) * innerR).toFixed(1)}`);
    rot += step;
  }
  return pts.join(' ');
}

/* ---------- sky_nature ---------- */
function renderElSun(p) {
  const c = p.color || '#f5a623';
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x1 = 50 + Math.cos(a) * 32, y1 = 50 + Math.sin(a) * 32;
    const x2 = 50 + Math.cos(a) * 44, y2 = 50 + Math.sin(a) * 44;
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;
  }
  return `${rays}<circle cx="50" cy="50" r="24" fill="${c}"/>`;
}
function renderElMoon(p) {
  const c = p.color || '#e8ecf5';
  return `<path d="M 62,15 A 35,35 0 1 0 62,85 A 27,27 0 1 1 62,15 Z" fill="${c}"/>`;
}
function renderElCloud(p) {
  const c = p.color || '#ffffff';
  const stroke = p.stroke || '#c7d0dc';
  return `<path d="M 22,68 C 10,68 8,52 20,49 C 18,35 38,28 46,38 C 54,26 76,30 76,46 C 88,46 90,68 76,68 Z" fill="${c}" stroke="${stroke}" stroke-width="2"/>`;
}
function renderElStar(p) {
  const c = p.color || '#f7c948';
  return `<polygon points="${_elStarPoints(50, 50, 5, 40, 17)}" fill="${c}"/>`;
}
function renderElRainbow(p) {
  const bands = [p.color || '#e04f4f', '#f2b632', '#f5d76e', '#22c55e', '#4f9de0', p.color2 || '#a855f7'];
  let arcs = '';
  bands.forEach((c, i) => {
    const r = 46 - i * 7;
    arcs += `<path d="M ${50 - r},94 A ${r},${r} 0 0 1 ${50 + r},94" fill="none" stroke="${c}" stroke-width="6.5" stroke-linecap="round"/>`;
  });
  return arcs;
}
function renderElMountainPeak(p) {
  const back = p.color2 || '#a4b3c8';
  const front = p.color || '#7d8ba1';
  return `<polygon points="66,20 96,80 36,80" fill="${back}"/>
    <polygon points="34,10 74,80 -6,80" fill="${front}"/>
    <polygon points="34,10 46,32 22,32" fill="#e8ecf5"/>`;
}
function renderElWindSwirl(p) {
  const c = p.color || '#8ab4d9';
  return `<path d="M 6,32 L 62,32 C 76,32 76,14 62,14 C 52,14 50,24 50,24" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <path d="M 6,54 L 78,54 C 94,54 94,74 78,74 C 66,74 64,62 64,62" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <path d="M 6,86 L 46,86 C 58,86 58,70 46,70" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" opacity="0.7"/>`;
}
function renderElSunrise(p) {
  const c = p.color || '#f5a623';
  const glow = p.color2 || '#f7c948';
  let rays = '';
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i / 6) * Math.PI;
    const x1 = 50 + Math.cos(a) * 26, y1 = 70 + Math.sin(a) * 26;
    const x2 = 50 + Math.cos(a) * 40, y2 = 70 + Math.sin(a) * 40;
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${glow}" stroke-width="4" stroke-linecap="round"/>`;
  }
  return `${rays}<path d="M 18,70 A 32,32 0 0 1 82,70 Z" fill="${c}"/>
    <line x1="2" y1="70" x2="98" y2="70" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
}
function renderElSunset(p) {
  const c = p.color || '#e0654f';
  const glow = p.color2 || '#f2b632';
  return `<circle cx="50" cy="72" r="26" fill="${c}"/>
    <line x1="2" y1="82" x2="98" y2="82" stroke="${glow}" stroke-width="4" stroke-linecap="round"/>
    <path d="M 4,58 C 24,52 76,52 96,58" fill="none" stroke="${glow}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`;
}
function renderElComet(p) {
  const c = p.color || '#f7c948';
  const tail = p.color2 || '#bfe3f5';
  return `<path d="M 78,22 L 6,50 L 26,44 L 14,60 L 34,54 L 30,72 L 78,22 Z" fill="${tail}" opacity="0.7"/>
    <circle cx="78" cy="22" r="14" fill="${c}"/>
    <circle cx="78" cy="22" r="7" fill="#ffffff" opacity="0.5"/>`;
}
function renderElAurora(p) {
  const c1 = p.color || '#22c55e';
  const c2 = p.color2 || '#a855f7';
  return `<path d="M 4,70 C 20,30 40,20 50,50 C 60,20 80,30 96,70" fill="none" stroke="${c1}" stroke-width="10" stroke-linecap="round" opacity="0.85"/>
    <path d="M 4,82 C 20,42 40,32 50,62 C 60,32 80,42 96,82" fill="none" stroke="${c2}" stroke-width="8" stroke-linecap="round" opacity="0.7"/>
    <path d="M 4,94 C 22,62 38,50 50,74 C 62,50 78,62 96,94" fill="none" stroke="${c1}" stroke-width="6" stroke-linecap="round" opacity="0.5"/>`;
}
function renderElTornado(p) {
  const c = p.color || '#7d8ba1';
  let bands = '';
  for (let i = 0; i < 6; i++) {
    const w = 32 - i * 5;
    const y = 12 + i * 13;
    bands += `<ellipse cx="50" cy="${y}" rx="${w}" ry="4" fill="${c}" opacity="${1 - i * 0.05}"/>`;
  }
  return bands;
}
function renderElFogMist(p) {
  const c = p.color || '#c7d0dc';
  let lines = '';
  for (let i = 0; i < 5; i++) {
    const y = 20 + i * 15;
    const x1 = i % 2 === 0 ? 10 : 20;
    const x2 = i % 2 === 0 ? 90 : 80;
    lines += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${c}" stroke-width="6" stroke-linecap="round" opacity="${0.9 - i * 0.1}"/>`;
  }
  return lines;
}
function renderElEclipse(p) {
  const c = p.color || '#2b2b40';
  const glow = p.color2 || '#f5c518';
  return `<circle cx="50" cy="50" r="42" fill="${glow}" opacity="0.4"/>
    <circle cx="50" cy="50" r="34" fill="${glow}"/>
    <circle cx="42" cy="46" r="30" fill="${c}"/>`;
}

/* ---------- weather ---------- */
function renderElRaindrop(p) {
  const c = p.color || '#4f9de0';
  return `<path d="M 50,10 C 65,35 78,52 78,66 C 78,84 65,95 50,95 C 35,95 22,84 22,66 C 22,52 35,35 50,10 Z" fill="${c}"/>
    <ellipse cx="40" cy="68" rx="7" ry="10" fill="#ffffff" opacity="0.35"/>`;
}
function renderElSnowflake(p) {
  const c = p.color || '#bfe3f5';
  let arms = '';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x2 = 50 + Math.cos(a) * 38, y2 = 50 + Math.sin(a) * 38;
    const bx1 = 50 + Math.cos(a) * 22, by1 = 50 + Math.sin(a) * 22;
    const perp = a + Math.PI / 2;
    const b1x = bx1 + Math.cos(perp) * 7, b1y = by1 + Math.sin(perp) * 7;
    const b2x = bx1 - Math.cos(perp) * 7, b2y = by1 - Math.sin(perp) * 7;
    arms += `<line x1="50" y1="50" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
      <line x1="${bx1.toFixed(1)}" y1="${by1.toFixed(1)}" x2="${b1x.toFixed(1)}" y2="${b1y.toFixed(1)}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
      <line x1="${bx1.toFixed(1)}" y1="${by1.toFixed(1)}" x2="${b2x.toFixed(1)}" y2="${b2y.toFixed(1)}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
  }
  return arms;
}
function renderElLightningBolt(p) {
  const c = p.color || '#f5c518';
  return `<polygon points="58,8 24,56 46,56 38,94 78,42 54,42" fill="${c}" stroke="#c99a10" stroke-width="2" stroke-linejoin="round"/>`;
}
function renderElSunCloud(p) {
  const sun = p.color || '#f5a623';
  const cloud = p.color2 || '#ffffff';
  let rays = '';
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    const x1 = 34 + Math.cos(a) * 22, y1 = 34 + Math.sin(a) * 22;
    const x2 = 34 + Math.cos(a) * 32, y2 = 34 + Math.sin(a) * 32;
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${sun}" stroke-width="4" stroke-linecap="round"/>`;
  }
  return `${rays}<circle cx="34" cy="34" r="16" fill="${sun}"/>
    <path d="M 30,78 C 18,78 16,62 28,59 C 26,45 46,38 54,48 C 62,36 84,40 84,56 C 96,56 98,78 84,78 Z" fill="${cloud}" stroke="#c7d0dc" stroke-width="2"/>`;
}
function renderElUmbrella(p) {
  const canopy = p.color || '#4f7df3';
  const pole = p.color2 || '#4a4a4a';
  return `<path d="M 6,44 C 6,18 30,4 50,4 C 70,4 94,18 94,44 C 88,38 78,36 72,44 C 66,36 56,34 50,44
           C 44,34 34,36 28,44 C 22,36 12,38 6,44 Z" fill="${canopy}"/>
    <line x1="50" y1="4" x2="50" y2="86" stroke="${pole}" stroke-width="4"/>
    <path d="M 34,86 C 34,96 50,96 50,86" fill="none" stroke="${pole}" stroke-width="4"/>`;
}
function renderElHailStones(p) {
  const c = p.color || '#bfe3f5';
  return `<circle cx="20" cy="20" r="9" fill="${c}" stroke="#8ab4d9" stroke-width="2"/>
    <circle cx="70" cy="14" r="10" fill="${c}" stroke="#8ab4d9" stroke-width="2"/>
    <circle cx="42" cy="50" r="11" fill="${c}" stroke="#8ab4d9" stroke-width="2"/>
    <circle cx="14" cy="70" r="9" fill="${c}" stroke="#8ab4d9" stroke-width="2"/>
    <circle cx="78" cy="56" r="10" fill="${c}" stroke="#8ab4d9" stroke-width="2"/>
    <circle cx="44" cy="88" r="10" fill="${c}" stroke="#8ab4d9" stroke-width="2"/>
    <circle cx="82" cy="86" r="8" fill="${c}" stroke="#8ab4d9" stroke-width="2"/>`;
}
function renderElThermometer(p) {
  const c = p.color || '#e04f4f';
  const body = p.color2 || '#ffffff';
  return `<rect x="42" y="6" width="16" height="70" rx="8" fill="${body}" stroke="#8a8f9c" stroke-width="3"/>
    <circle cx="50" cy="86" r="12" fill="${c}"/>
    <rect x="46" y="40" width="8" height="42" fill="${c}"/>
    ${[0,1,2,3,4].map(i => `<line x1="58" y1="${20 + i * 12}" x2="66" y2="${20 + i * 12}" stroke="#8a8f9c" stroke-width="2"/>`).join('')}`;
}
function renderElWeatherVane(p) {
  const c = p.color || '#4a5568';
  const arrow = p.color2 || '#f2b632';
  return `<line x1="50" y1="30" x2="50" y2="94" stroke="${c}" stroke-width="4"/>
    <line x1="30" y1="94" x2="70" y2="94" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="20" y1="40" x2="80" y2="40" stroke="${c}" stroke-width="3"/>
    <polygon points="80,40 66,32 66,48" fill="${arrow}"/>
    <polygon points="20,40 34,32 34,48" fill="${c}" opacity="0.7"/>
    <text x="50" y="24" font-size="14" font-family="Georgia, serif" text-anchor="middle" fill="${c}" font-weight="bold">N</text>`;
}
function renderElStormCloud(p) {
  const cloud = p.color || '#4a5568';
  const bolt = p.color2 || '#f5c518';
  return `<path d="M 22,58 C 10,58 8,42 20,39 C 18,25 38,18 46,28 C 54,16 76,20 76,36 C 88,36 90,58 76,58 Z" fill="${cloud}"/>
    <polygon points="54,58 38,80 48,80 44,96 62,72 52,72" fill="${bolt}"/>`;
}
function renderElFrostPattern(p) {
  const c = p.color || '#bfe3f5';
  let arms = '';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x2 = 50 + Math.cos(a) * 40, y2 = 50 + Math.sin(a) * 40;
    const x3 = 50 + Math.cos(a) * 24, y3 = 50 + Math.sin(a) * 24;
    const perp = a + Math.PI / 3;
    const fx = x3 + Math.cos(perp) * 10, fy = y3 + Math.sin(perp) * 10;
    const gx = x3 - Math.cos(perp) * 10, gy = y3 - Math.sin(perp) * 10;
    arms += `<line x1="50" y1="50" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
      <line x1="${x3.toFixed(1)}" y1="${y3.toFixed(1)}" x2="${fx.toFixed(1)}" y2="${fy.toFixed(1)}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${x3.toFixed(1)}" y1="${y3.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return arms;
}

/* ---------- home_objects ---------- */
function renderElHouse(p) {
  const wall = p.color || '#d9734e';
  const roof = p.color2 || '#6d2f22';
  return `<polygon points="50,10 92,42 82,42 82,44 18,44 18,42 8,42" fill="${roof}"/>
    <rect x="20" y="44" width="60" height="46" fill="${wall}"/>
    <rect x="43" y="62" width="14" height="28" fill="#4a2c1e"/>
    <rect x="27" y="52" width="14" height="14" fill="#f4e4c1" stroke="#4a2c1e" stroke-width="1.5"/>
    <rect x="59" y="52" width="14" height="14" fill="#f4e4c1" stroke="#4a2c1e" stroke-width="1.5"/>`;
}
function renderElKey(p) {
  const c = p.color || '#d9a441';
  return `<circle cx="28" cy="32" r="18" fill="none" stroke="${c}" stroke-width="9"/>
    <rect x="26" y="42" width="9" height="52" fill="${c}"/>
    <rect x="35" y="70" width="12" height="8" fill="${c}"/>
    <rect x="35" y="84" width="16" height="8" fill="${c}"/>`;
}
function renderElLightbulb(p) {
  const glass = p.color || '#f5c518';
  const base = p.color2 || '#8a8f9c';
  return `<circle cx="50" cy="38" r="28" fill="${glass}"/>
    <path d="M 38,60 L 62,60 L 58,72 L 42,72 Z" fill="${glass}"/>
    <rect x="40" y="72" width="20" height="8" fill="${base}"/>
    <rect x="40" y="82" width="20" height="6" rx="2" fill="${base}"/>
    <line x1="50" y1="18" x2="50" y2="28" stroke="#c99a10" stroke-width="3" stroke-linecap="round"/>
    <line x1="34" y1="24" x2="40" y2="32" stroke="#c99a10" stroke-width="3" stroke-linecap="round"/>
    <line x1="66" y1="24" x2="60" y2="32" stroke="#c99a10" stroke-width="3" stroke-linecap="round"/>`;
}
function renderElSofa(p) {
  const c = p.color || '#4f7df3';
  const cushion = p.color2 || '#2f5fc0';
  return `<rect x="8" y="46" width="16" height="34" rx="6" fill="${c}"/>
    <rect x="76" y="46" width="16" height="34" rx="6" fill="${c}"/>
    <rect x="16" y="36" width="68" height="30" rx="8" fill="${c}"/>
    <rect x="20" y="58" width="28" height="22" rx="5" fill="${cushion}"/>
    <rect x="52" y="58" width="28" height="22" rx="5" fill="${cushion}"/>
    <rect x="12" y="80" width="76" height="10" rx="3" fill="${c}"/>`;
}
function renderElCurtain(p) {
  const c = p.color || '#e04f4f';
  const rod = p.color2 || '#8a8f9c';
  return `<rect x="4" y="6" width="92" height="6" rx="3" fill="${rod}"/>
    <path d="M 10,12 C 6,40 14,70 8,94 L 24,94 C 20,70 26,40 22,12 Z" fill="${c}"/>
    <path d="M 30,12 C 26,40 34,70 28,94 L 44,94 C 40,70 46,40 42,12 Z" fill="${c}" opacity="0.9"/>
    <path d="M 58,12 C 54,40 62,70 56,94 L 72,94 C 68,70 74,40 70,12 Z" fill="${c}" opacity="0.9"/>
    <path d="M 78,12 C 74,40 82,70 76,94 L 92,94 C 88,70 94,40 90,12 Z" fill="${c}"/>`;
}
function renderElDoor(p) {
  const c = p.color || '#6d4a2f';
  const knob = p.color2 || '#f2b632';
  return `<rect x="18" y="4" width="64" height="92" rx="3" fill="${c}"/>
    <rect x="26" y="14" width="20" height="34" rx="2" fill="none" stroke="#4a2c1e" stroke-width="2"/>
    <rect x="54" y="14" width="20" height="34" rx="2" fill="none" stroke="#4a2c1e" stroke-width="2"/>
    <rect x="26" y="54" width="20" height="30" rx="2" fill="none" stroke="#4a2c1e" stroke-width="2"/>
    <rect x="54" y="54" width="20" height="30" rx="2" fill="none" stroke="#4a2c1e" stroke-width="2"/>
    <circle cx="72" cy="52" r="4" fill="${knob}"/>`;
}
function renderElChair(p) {
  const c = p.color || '#d9a441';
  return `<rect x="24" y="8" width="52" height="8" rx="3" fill="${c}"/>
    <rect x="24" y="8" width="8" height="52" fill="${c}"/>
    <rect x="68" y="8" width="8" height="52" fill="${c}"/>
    <rect x="18" y="52" width="64" height="10" rx="3" fill="${c}"/>
    <rect x="22" y="62" width="8" height="34" fill="${c}"/>
    <rect x="70" y="62" width="8" height="34" fill="${c}"/>`;
}
function renderElTable(p) {
  const c = p.color || '#8a5a2f';
  return `<rect x="8" y="40" width="84" height="8" rx="3" fill="${c}"/>
    <rect x="14" y="48" width="8" height="46" fill="${c}"/>
    <rect x="78" y="48" width="8" height="46" fill="${c}"/>`;
}
function renderElMirror(p) {
  const frame = p.color || '#d9a441';
  const glass = p.color2 || '#bfe3f5';
  return `<ellipse cx="50" cy="46" rx="34" ry="40" fill="${frame}"/>
    <ellipse cx="50" cy="46" rx="28" ry="34" fill="${glass}"/>
    <path d="M 32,26 C 40,18 52,18 62,24" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.7"/>`;
}
function renderElVase(p) {
  const c = p.color || '#4f9de0';
  const flower = p.color2 || '#f28ba8';
  return `<path d="M 34,30 C 26,50 24,72 32,92 L 68,92 C 76,72 74,50 66,30 Z" fill="${c}"/>
    <rect x="30" y="24" width="40" height="8" rx="2" fill="${c}"/>
    <circle cx="50" cy="14" r="10" fill="${flower}"/>
    <circle cx="50" cy="14" r="4" fill="#f2b632"/>`;
}
function renderElBed(p) {
  const frame = p.color || '#4f7df3';
  const pillow = p.color2 || '#ffffff';
  return `<rect x="6" y="60" width="88" height="24" rx="4" fill="${frame}"/>
    <rect x="6" y="44" width="88" height="20" rx="3" fill="${frame}" opacity="0.85"/>
    <rect x="10" y="46" width="24" height="16" rx="3" fill="${pillow}"/>
    <rect x="6" y="38" width="88" height="8" rx="3" fill="${frame}"/>
    <rect x="8" y="84" width="6" height="10" fill="#2b2b40"/>
    <rect x="86" y="84" width="6" height="10" fill="#2b2b40"/>`;
}
function renderElRug(p) {
  const c = p.color || '#e04f4f';
  const c2 = p.color2 || '#f2b632';
  return `<rect x="4" y="20" width="92" height="60" rx="6" fill="${c}"/>
    <rect x="12" y="28" width="76" height="44" rx="3" fill="none" stroke="${c2}" stroke-width="3"/>
    <line x1="20" y1="50" x2="80" y2="50" stroke="${c2}" stroke-width="3" stroke-dasharray="4 6"/>`;
}

/* ---------- desk_objects ---------- */
function renderElPen(p) {
  const body = p.color || '#2f6fb3';
  const tip = p.color2 || '#e8b48a';
  return `<g transform="rotate(45 50 50)">
    <rect x="42" y="8" width="16" height="62" rx="3" fill="${body}"/>
    <polygon points="42,70 58,70 50,94" fill="${tip}"/>
    <polygon points="47,88 53,88 50,94" fill="#3d2b1f"/>
    <rect x="42" y="8" width="16" height="10" fill="#1f3f66"/>
  </g>`;
}
function renderElClock(p) {
  const face = p.color2 || '#ffffff';
  const rim = p.color || '#3f6fb0';
  return `<circle cx="50" cy="50" r="40" fill="${face}" stroke="${rim}" stroke-width="7"/>
    <circle cx="50" cy="16" r="2.6" fill="${rim}"/>
    <circle cx="50" cy="84" r="2.6" fill="${rim}"/>
    <circle cx="16" cy="50" r="2.6" fill="${rim}"/>
    <circle cx="84" cy="50" r="2.6" fill="${rim}"/>
    <line x1="50" y1="50" x2="50" y2="28" stroke="${rim}" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="50" y1="50" x2="66" y2="58" stroke="${rim}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="4.5" fill="${rim}"/>`;
}
function renderElBook(p) {
  const cover = p.color || '#3f7d5c';
  return `<path d="M 12,20 C 26,12 40,12 50,20 L 50,86 C 40,78 26,78 12,86 Z" fill="${cover}"/>
    <path d="M 88,20 C 74,12 60,12 50,20 L 50,86 C 60,78 74,78 88,86 Z" fill="${cover}" opacity="0.82"/>
    <line x1="50" y1="20" x2="50" y2="86" stroke="#1f3f30" stroke-width="2"/>
    <line x1="18" y1="34" x2="42" y2="30" stroke="#eef3ea" stroke-width="2" opacity="0.85"/>
    <line x1="18" y1="46" x2="42" y2="42" stroke="#eef3ea" stroke-width="2" opacity="0.85"/>`;
}
function renderElNotebook(p) {
  const cover = p.color || '#4f7df3';
  const spiral = p.color2 || '#8a8f9c';
  return `<rect x="16" y="10" width="68" height="80" rx="4" fill="${cover}"/>
    <rect x="24" y="10" width="6" height="80" fill="#ffffff" opacity="0.25"/>
    <line x1="30" y1="28" x2="76" y2="28" stroke="#ffffff" stroke-width="2.5" opacity="0.7"/>
    <line x1="30" y1="40" x2="76" y2="40" stroke="#ffffff" stroke-width="2.5" opacity="0.7"/>
    <line x1="30" y1="52" x2="66" y2="52" stroke="#ffffff" stroke-width="2.5" opacity="0.7"/>
    ${[0,1,2,3,4].map(i => `<circle cx="16" cy="${20 + i * 16}" r="4" fill="${spiral}"/>`).join('')}`;
}
function renderElCalculator(p) {
  const body = p.color || '#2b2b40';
  const screen = p.color2 || '#8fd9a0';
  return `<rect x="18" y="6" width="64" height="88" rx="7" fill="${body}"/>
    <rect x="26" y="16" width="48" height="18" rx="2" fill="${screen}"/>
    ${[0, 1, 2, 3].map(row => [0, 1, 2].map(col =>
      `<rect x="${26 + col * 17}" y="${42 + row * 13}" width="12" height="9" rx="2" fill="#e8ecf5" opacity="0.85"/>`
    ).join('')).join('')}`;
}
function renderElPaperclip(p) {
  const c = p.color || '#8a8f9c';
  return `<g transform="rotate(-20 50 50)">
    <path d="M 40,14 C 24,14 14,26 14,42 L 14,72 C 14,84 24,92 36,92 C 48,92 56,84 56,72 L 56,30
             C 56,22 50,16 42,16 C 34,16 30,22 30,30 L 30,70" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
  </g>`;
}
function renderElStapler(p) {
  const c = p.color || '#e04f4f';
  const metal = p.color2 || '#c7d0dc';
  return `<path d="M 8,70 L 90,70 L 90,84 C 90,88 86,92 82,92 L 16,92 C 12,92 8,88 8,84 Z" fill="${metal}"/>
    <path d="M 10,68 L 92,42 C 96,40 96,32 90,30 L 26,10 C 18,8 10,14 10,24 Z" fill="${c}"/>`;
}
function renderElEraser(p) {
  const c = p.color || '#f28ba8';
  const c2 = p.color2 || '#ffffff';
  return `<g transform="rotate(-20 50 50)">
    <rect x="14" y="34" width="72" height="32" rx="4" fill="${c}"/>
    <rect x="60" y="34" width="26" height="32" rx="4" fill="${c2}"/>
    <line x1="14" y1="50" x2="86" y2="50" stroke="#c05878" stroke-width="2" opacity="0.5"/>
  </g>`;
}
function renderElScissors(p) {
  const c = p.color || '#8a8f9c';
  const handle = p.color2 || '#e04f4f';
  return `<g transform="rotate(-30 50 50)">
    <line x1="30" y1="20" x2="60" y2="80" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <line x1="70" y1="20" x2="40" y2="80" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="26" cy="86" r="9" fill="none" stroke="${handle}" stroke-width="5"/>
    <circle cx="74" cy="86" r="9" fill="none" stroke="${handle}" stroke-width="5"/>
    <circle cx="50" cy="52" r="4" fill="${c}"/>
  </g>`;
}
function renderElTapeDispenser(p) {
  const c = p.color || '#4f7df3';
  const tape = p.color2 || '#ffffff';
  return `<circle cx="42" cy="42" r="30" fill="${c}"/>
    <circle cx="42" cy="42" r="20" fill="${tape}" opacity="0.7"/>
    <rect x="40" y="42" width="50" height="14" rx="3" fill="${tape}" opacity="0.85"/>
    <polygon points="86,42 96,49 86,56" fill="#c7d0dc"/>`;
}
function renderElHighlighter(p) {
  const c = p.color || '#f5d76e';
  const cap = p.color2 || '#2b2b40';
  return `<g transform="rotate(40 50 50)">
    <rect x="42" y="20" width="16" height="56" rx="3" fill="${c}"/>
    <rect x="40" y="76" width="20" height="10" rx="2" fill="${cap}"/>
    <rect x="42" y="10" width="16" height="12" fill="${cap}"/>
  </g>`;
}
function renderElMagnifier(p) {
  const c = p.color || '#4a5568';
  const glass = p.color2 || '#bfe3f5';
  return `<circle cx="42" cy="42" r="30" fill="${glass}" stroke="${c}" stroke-width="7"/>
    <line x1="64" y1="64" x2="92" y2="92" stroke="${c}" stroke-width="9" stroke-linecap="round"/>
    <path d="M 28,30 C 34,22 48,22 56,28" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.7"/>`;
}
function renderElBinderClip(p) {
  const c = p.color || '#2b2b40';
  return `<rect x="20" y="40" width="60" height="36" rx="4" fill="${c}"/>
    <path d="M 30,40 L 30,22 C 30,14 38,10 44,14" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <path d="M 70,40 L 70,22 C 70,14 62,10 56,14" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <line x1="24" y1="58" x2="76" y2="58" stroke="#ffffff" stroke-width="2" opacity="0.4"/>`;
}
function renderElDeskOrganizer(p) {
  const c = p.color || '#4a5568';
  const pens = p.color2 || '#f2b632';
  return `<rect x="14" y="46" width="72" height="46" rx="5" fill="${c}"/>
    <rect x="22" y="20" width="6" height="30" fill="${pens}"/>
    <rect x="34" y="16" width="6" height="34" fill="#e04f4f"/>
    <rect x="46" y="22" width="6" height="28" fill="#4f7df3"/>
    <rect x="58" y="18" width="6" height="32" fill="#22c55e"/>
    <rect x="70" y="24" width="6" height="26" fill="${pens}"/>`;
}

/* ---------- education ---------- */
function renderElGraduationCap(p) {
  const cap = p.color || '#2b2b40';
  const tassel = p.color2 || '#f2b632';
  return `<polygon points="50,22 92,42 50,62 8,42" fill="${cap}"/>
    <path d="M 26,50 L 26,68 C 26,76 74,76 74,68 L 74,50 L 50,62 Z" fill="${cap}" opacity="0.9"/>
    <line x1="86" y1="42" x2="86" y2="66" stroke="${cap}" stroke-width="3"/>
    <circle cx="86" cy="70" r="4" fill="${tassel}"/>
    <line x1="50" y1="62" x2="50" y2="42" stroke="${tassel}" stroke-width="2.5"/>
    <circle cx="50" cy="40" r="3.4" fill="${tassel}"/>`;
}
function renderElPencil(p) {
  const body = p.color || '#f2b632';
  return `<g transform="rotate(45 50 50)">
    <rect x="42" y="6" width="16" height="58" fill="${body}"/>
    <polygon points="42,64 58,64 50,80" fill="#e8b48a"/>
    <polygon points="47,76 53,76 50,80" fill="#3d2b1f"/>
    <rect x="42" y="86" width="16" height="10" rx="3" fill="#e05a5a"/>
    <rect x="42" y="6" width="16" height="8" fill="#4a4a4a"/>
    <line x1="42" y1="14" x2="58" y2="64" stroke="#c99a10" stroke-width="1" opacity="0.5"/>
  </g>`;
}
function renderElBackpack(p) {
  const c = p.color || '#4f7df3';
  const pocket = p.color2 || '#2f5fc0';
  return `<rect x="24" y="10" width="20" height="14" rx="7" fill="none" stroke="${c}" stroke-width="6"/>
    <rect x="16" y="30" width="68" height="60" rx="14" fill="${c}"/>
    <rect x="30" y="58" width="40" height="26" rx="8" fill="${pocket}"/>
    <line x1="50" y1="30" x2="50" y2="90" stroke="${pocket}" stroke-width="4"/>
    <rect x="40" y="30" width="20" height="10" rx="3" fill="${pocket}"/>`;
}
function renderElRuler(p) {
  const c = p.color || '#f2b632';
  const tick = p.color2 || '#2b2b40';
  return `<g transform="rotate(-30 50 50)">
    <rect x="8" y="38" width="84" height="24" rx="3" fill="${c}" stroke="${tick}" stroke-width="2"/>
    ${[0, 1, 2, 3, 4, 5, 6].map(i => `<line x1="${14 + i * 11}" y1="38" x2="${14 + i * 11}" y2="${i % 2 === 0 ? 50 : 46}" stroke="${tick}" stroke-width="2"/>`).join('')}
  </g>`;
}
function renderElGlobeStand(p) {
  const globe = p.color || '#2f7d6a';
  const stand = p.color2 || '#6d4a2f';
  return `<circle cx="50" cy="38" r="30" fill="${globe}"/>
    <ellipse cx="50" cy="38" rx="30" ry="12" fill="none" stroke="#eef3ea" stroke-width="2" opacity="0.7"/>
    <path d="M 50,8 C 38,20 38,56 50,68" fill="none" stroke="#eef3ea" stroke-width="2" opacity="0.7"/>
    <path d="M 50,8 C 62,20 62,56 50,68" fill="none" stroke="#eef3ea" stroke-width="2" opacity="0.7"/>
    <line x1="50" y1="68" x2="50" y2="82" stroke="${stand}" stroke-width="5"/>
    <path d="M 30,94 L 70,94 L 62,82 L 38,82 Z" fill="${stand}"/>`;
}
function renderElChalkboard(p) {
  const board = p.color || '#2f5c40';
  const frame = p.color2 || '#6d4a2f';
  return `<rect x="6" y="10" width="88" height="60" rx="2" fill="${frame}"/>
    <rect x="12" y="16" width="76" height="48" fill="${board}"/>
    <line x1="20" y1="30" x2="56" y2="30" stroke="#eef3ea" stroke-width="3" opacity="0.85"/>
    <line x1="20" y1="42" x2="70" y2="42" stroke="#eef3ea" stroke-width="3" opacity="0.85"/>
    <rect x="30" y="70" width="40" height="8" rx="2" fill="${frame}"/>
    <rect x="42" y="78" width="16" height="16" fill="${frame}"/>`;
}
function renderElMicroscope(p) {
  const c = p.color || '#4a5568';
  const lens = p.color2 || '#bfe3f5';
  return `<rect x="18" y="86" width="64" height="8" rx="3" fill="${c}"/>
    <rect x="30" y="60" width="40" height="26" rx="3" fill="${c}"/>
    <path d="M 40,60 L 40,20 C 40,14 46,10 52,10 L 60,10 L 60,30 L 56,30 L 56,60 Z" fill="${c}"/>
    <rect x="52" y="14" width="14" height="14" fill="${lens}"/>
    <rect x="24" y="68" width="12" height="20" fill="#8a8f9c"/>`;
}
function renderElSchoolBus(p) {
  const body = p.color || '#f2b632';
  const win = p.color2 || '#bfe3f5';
  return `<rect x="4" y="24" width="88" height="46" rx="6" fill="${body}"/>
    <rect x="10" y="32" width="14" height="14" fill="${win}"/>
    <rect x="28" y="32" width="14" height="14" fill="${win}"/>
    <rect x="46" y="32" width="14" height="14" fill="${win}"/>
    <rect x="64" y="32" width="14" height="14" fill="${win}"/>
    <rect x="4" y="54" width="88" height="6" fill="#e04f4f"/>
    <circle cx="22" cy="76" r="9" fill="#2b2b40"/>
    <circle cx="74" cy="76" r="9" fill="#2b2b40"/>
    <text x="50" y="21" font-size="12" font-family="Arial, sans-serif" text-anchor="middle" fill="#2b2b40" font-weight="bold">SCHOOL</text>`;
}
function renderElReportCard(p) {
  const paper = p.color || '#ffffff';
  const accent = p.color2 || '#4f7df3';
  return `<rect x="16" y="6" width="68" height="88" rx="4" fill="${paper}" stroke="#c7d0dc" stroke-width="2"/>
    <rect x="16" y="6" width="68" height="14" fill="${accent}"/>
    <line x1="24" y1="32" x2="76" y2="32" stroke="${accent}" stroke-width="3"/>
    <line x1="24" y1="44" x2="66" y2="44" stroke="${accent}" stroke-width="3"/>
    <line x1="24" y1="56" x2="70" y2="56" stroke="${accent}" stroke-width="3"/>
    <text x="50" y="80" font-size="20" font-family="Arial, sans-serif" text-anchor="middle" fill="#22c55e" font-weight="bold">A+</text>`;
}
function renderElLunchBox(p) {
  const c = p.color || '#e04f4f';
  const handle = p.color2 || '#2b2b40';
  return `<rect x="14" y="34" width="72" height="56" rx="6" fill="${c}"/>
    <path d="M 34,34 C 34,20 66,20 66,34" fill="none" stroke="${handle}" stroke-width="5"/>
    <rect x="14" y="52" width="72" height="6" fill="#ffffff" opacity="0.5"/>
    <rect x="44" y="52" width="12" height="10" rx="2" fill="${handle}"/>`;
}
function renderElLibraryShelf(p) {
  const wood = p.color || '#6d4a2f';
  const books = ['#e04f4f', '#4f7df3', '#22c55e', '#f2b632', '#a855f7'];
  let bookSet = '';
  books.forEach((bc, i) => {
    bookSet += `<rect x="${12 + i * 15}" y="${32 + (i % 2) * 4}" width="11" height="34" fill="${bc}"/>`;
  });
  return `<rect x="4" y="20" width="92" height="8" fill="${wood}"/>
    ${bookSet}
    <rect x="4" y="66" width="92" height="8" fill="${wood}"/>`;
}
function renderElAbacus(p) {
  const frame = p.color || '#d9a441';
  const bead1 = p.color2 || '#e04f4f';
  let rods = '';
  for (let i = 0; i < 4; i++) {
    rods += `<line x1="14" y1="${30 + i * 15}" x2="86" y2="${30 + i * 15}" stroke="#8a8f9c" stroke-width="2"/>`;
    for (let j = 0; j < 4; j++) {
      rods += `<circle cx="${26 + j * 15}" cy="${30 + i * 15}" r="5" fill="${j % 2 === 0 ? bead1 : '#4f7df3'}"/>`;
    }
  }
  return `<rect x="8" y="14" width="84" height="72" rx="4" fill="none" stroke="${frame}" stroke-width="6"/>${rods}`;
}

/* ---------- tech ---------- */
function renderElMobilePhone(p) {
  const body = p.color || '#2b2b40';
  const screen = p.color2 || '#bfe3f5';
  return `<rect x="30" y="6" width="40" height="88" rx="9" fill="${body}"/>
    <rect x="35" y="16" width="30" height="60" fill="${screen}"/>
    <circle cx="50" cy="88" r="4" fill="${screen}"/>`;
}
function renderElLaptop(p) {
  const body = p.color || '#4a5568';
  const screen = p.color2 || '#bfe3f5';
  return `<rect x="22" y="14" width="56" height="40" rx="3" fill="${body}"/>
    <rect x="26" y="18" width="48" height="32" fill="${screen}"/>
    <path d="M 10,56 L 90,56 L 96,74 C 96,78 92,80 88,80 L 12,80 C 8,80 4,78 4,74 Z" fill="${body}"/>
    <rect x="42" y="60" width="16" height="4" rx="2" fill="${screen}"/>`;
}
function renderElWifiSignal(p) {
  const c = p.color || '#2f7d6a';
  return `<circle cx="50" cy="82" r="6" fill="${c}"/>
    <path d="M 34,64 A 24,24 0 0 1 66,64" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <path d="M 20,48 A 44,44 0 0 1 80,48" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <path d="M 6,32 A 64,64 0 0 1 94,32" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`;
}
function renderElTabletDevice(p) {
  const body = p.color || '#4a5568';
  const screen = p.color2 || '#bfe3f5';
  return `<rect x="16" y="8" width="68" height="84" rx="8" fill="${body}"/>
    <rect x="22" y="16" width="56" height="64" fill="${screen}"/>
    <circle cx="50" cy="87" r="3.4" fill="${screen}"/>`;
}
function renderElHeadphones(p) {
  const c = p.color || '#2b2b40';
  const cushion = p.color2 || '#4f7df3';
  return `<path d="M 14,58 L 14,44 C 14,20 30,6 50,6 C 70,6 86,20 86,44 L 86,58" fill="none" stroke="${c}" stroke-width="7"/>
    <rect x="8" y="54" width="18" height="30" rx="8" fill="${cushion}"/>
    <rect x="74" y="54" width="18" height="30" rx="8" fill="${cushion}"/>`;
}
function renderElCameraIcon(p) {
  const c = p.color || '#2b2b40';
  const lens = p.color2 || '#4f9de0';
  return `<rect x="6" y="26" width="88" height="60" rx="8" fill="${c}"/>
    <rect x="34" y="12" width="24" height="16" rx="3" fill="${c}"/>
    <circle cx="50" cy="56" r="20" fill="${lens}"/>
    <circle cx="50" cy="56" r="12" fill="#1a1a2a"/>
    <circle cx="80" cy="38" r="4" fill="#f5c518"/>`;
}
function renderElPrinter(p) {
  const c = p.color || '#8a8f9c';
  const paper = p.color2 || '#ffffff';
  return `<rect x="14" y="34" width="72" height="40" rx="6" fill="${c}"/>
    <rect x="24" y="10" width="52" height="28" fill="${paper}" stroke="#c7d0dc" stroke-width="2"/>
    <rect x="24" y="66" width="52" height="30" fill="${paper}" stroke="#c7d0dc" stroke-width="2"/>
    <circle cx="76" cy="46" r="3" fill="#22c55e"/>`;
}
function renderElKeyboard(p) {
  const body = p.color || '#2b2b40';
  const key = p.color2 || '#c7d0dc';
  let keys = '';
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      keys += `<rect x="${10 + c * 10}" y="${22 + r * 14}" width="8" height="10" rx="1.5" fill="${key}"/>`;
    }
  }
  return `<rect x="4" y="14" width="92" height="62" rx="6" fill="${body}"/>${keys}
    <rect x="30" y="64" width="40" height="8" rx="2" fill="${key}"/>`;
}
function renderElMouseDevice(p) {
  const c = p.color || '#2b2b40';
  const c2 = p.color2 || '#c7d0dc';
  return `<ellipse cx="50" cy="52" rx="24" ry="40" fill="${c}"/>
    <line x1="50" y1="14" x2="50" y2="38" stroke="${c2}" stroke-width="3"/>
    <rect x="44" y="24" width="12" height="14" rx="4" fill="${c2}"/>`;
}
function renderElMonitor(p) {
  const c = p.color || '#4a5568';
  const screen = p.color2 || '#bfe3f5';
  return `<rect x="6" y="10" width="88" height="58" rx="4" fill="${c}"/>
    <rect x="12" y="16" width="76" height="46" fill="${screen}"/>
    <rect x="42" y="68" width="16" height="14" fill="${c}"/>
    <rect x="26" y="82" width="48" height="8" rx="3" fill="${c}"/>`;
}
function renderElUsbDrive(p) {
  const c = p.color || '#8a8f9c';
  const c2 = p.color2 || '#4f7df3';
  return `<rect x="30" y="10" width="40" height="80" rx="5" fill="${c}"/>
    <rect x="38" y="4" width="24" height="14" fill="#c7d0dc"/>
    <line x1="44" y1="4" x2="44" y2="14" stroke="#2b2b40" stroke-width="2"/>
    <line x1="50" y1="4" x2="50" y2="14" stroke="#2b2b40" stroke-width="2"/>
    <line x1="56" y1="4" x2="56" y2="14" stroke="#2b2b40" stroke-width="2"/>
    <rect x="38" y="40" width="24" height="20" rx="3" fill="${c2}"/>`;
}
function renderElHardDrive(p) {
  const c = p.color || '#4a5568';
  const led = p.color2 || '#22c55e';
  return `<rect x="8" y="26" width="84" height="48" rx="6" fill="${c}"/>
    <circle cx="22" cy="50" r="10" fill="none" stroke="#2b2b40" stroke-width="3"/>
    <circle cx="22" cy="50" r="3" fill="#2b2b40"/>
    <line x1="44" y1="44" x2="80" y2="44" stroke="#2b2b40" stroke-width="3"/>
    <line x1="44" y1="56" x2="72" y2="56" stroke="#2b2b40" stroke-width="3"/>
    <circle cx="82" cy="64" r="3" fill="${led}"/>`;
}
function renderElRouter(p) {
  const c = p.color || '#2b2b40';
  const led = p.color2 || '#22c55e';
  return `<rect x="8" y="42" width="84" height="34" rx="5" fill="${c}"/>
    ${[0,1,2].map(i => `<circle cx="${22 + i * 12}" cy="66" r="3" fill="${led}"/>`).join('')}
    <line x1="24" y1="42" x2="14" y2="16" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="50" y1="42" x2="50" y2="14" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="76" y1="42" x2="86" y2="16" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
}
function renderElSmartwatch(p) {
  const body = p.color || '#4f7df3';
  const screen = p.color2 || '#2b2b40';
  return `<rect x="36" y="24" width="28" height="52" rx="8" fill="${body}"/>
    <rect x="30" y="4" width="40" height="22" rx="8" fill="${body}" opacity="0.9"/>
    <rect x="30" y="74" width="40" height="22" rx="8" fill="${body}" opacity="0.9"/>
    <rect x="40" y="30" width="20" height="40" rx="4" fill="${screen}"/>
    <text x="50" y="52" font-size="10" font-family="Arial, sans-serif" text-anchor="middle" fill="#ffffff">10:30</text>
    <rect x="62" y="42" width="4" height="12" rx="1" fill="#2b2b40"/>`;
}

/* ---------- icons_ui ---------- */
function renderElIconCheck(p) {
  const c = p.color || '#2f9e5c';
  return `<circle cx="50" cy="50" r="42" fill="${c}" opacity="0.14"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="5"/>
    <path d="M 30,52 L 44,66 L 72,34" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function renderElIconStarBadge(p) {
  const c = p.color || '#f2b632';
  return `<circle cx="50" cy="50" r="46" fill="${c}" opacity="0.14"/>
    <polygon points="${_elStarPoints(50, 50, 5, 44, 19)}" fill="${c}"/>`;
}
function renderElIconArrowRight(p) {
  const c = p.color || '#4f7df3';
  return `<circle cx="50" cy="50" r="42" fill="${c}" opacity="0.14"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="5"/>
    <line x1="28" y1="50" x2="66" y2="50" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <polyline points="52,34 70,50 52,66" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function renderElIconClose(p) {
  const c = p.color || '#e04f4f';
  return `<circle cx="50" cy="50" r="42" fill="${c}" opacity="0.14"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="5"/>
    <line x1="32" y1="32" x2="68" y2="68" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <line x1="68" y1="32" x2="32" y2="68" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`;
}
function renderElIconMenu(p) {
  const c = p.color || '#2b2b40';
  return `<circle cx="50" cy="50" r="42" fill="${c}" opacity="0.14"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="5"/>
    <line x1="26" y1="36" x2="74" y2="36" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <line x1="26" y1="50" x2="74" y2="50" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <line x1="26" y1="64" x2="74" y2="64" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`;
}
function renderElIconSearch(p) {
  const c = p.color || '#4f7df3';
  return `<circle cx="50" cy="50" r="42" fill="${c}" opacity="0.14"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="5"/>
    <circle cx="46" cy="46" r="16" fill="none" stroke="${c}" stroke-width="7"/>
    <line x1="58" y1="58" x2="74" y2="74" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`;
}

/* ---------- icons_concept ---------- */
function renderElIconGraph(p) {
  const c = p.color || '#4f7df3';
  return `<circle cx="50" cy="50" r="46" fill="${c}" opacity="0.12"/>
    <line x1="22" y1="78" x2="22" y2="22" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="22" y1="78" x2="82" y2="78" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <rect x="32" y="56" width="10" height="22" fill="${c}"/>
    <rect x="48" y="42" width="10" height="36" fill="${c}"/>
    <rect x="64" y="30" width="10" height="48" fill="${c}"/>`;
}
function renderElIconSchool(p) {
  const c = p.color || '#b3432f';
  return `<circle cx="50" cy="50" r="46" fill="${c}" opacity="0.12"/>
    <polygon points="50,20 84,36 50,52 16,36" fill="${c}"/>
    <rect x="30" y="52" width="40" height="26" fill="${c}" opacity="0.85"/>
    <rect x="44" y="60" width="12" height="18" fill="#ffffff"/>
    <line x1="78" y1="36" x2="78" y2="56" stroke="${c}" stroke-width="3"/>
    <circle cx="78" cy="59" r="3" fill="${c}"/>`;
}
function renderElIconTarget(p) {
  const c = p.color || '#e04f4f';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <circle cx="50" cy="50" r="30" fill="#ffffff"/>
    <circle cx="50" cy="50" r="16" fill="${c}"/>
    <circle cx="50" cy="50" r="5" fill="#ffffff"/>`;
}
function renderElIconIdea(p) {
  const c = p.color || '#f2b632';
  return `<circle cx="50" cy="50" r="46" fill="${c}" opacity="0.14"/>
    <circle cx="50" cy="40" r="22" fill="${c}"/>
    <rect x="40" y="60" width="20" height="6" fill="${c}"/>
    <rect x="42" y="70" width="16" height="6" fill="${c}"/>
    <line x1="50" y1="6" x2="50" y2="14" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="14" y1="22" x2="22" y2="28" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="86" y1="22" x2="78" y2="28" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
}
function renderElIconGrowth(p) {
  const c = p.color || '#22c55e';
  return `<circle cx="50" cy="50" r="46" fill="${c}" opacity="0.14"/>
    <polyline points="16,80 36,58 50,70 84,32" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <polygon points="84,32 66,34 82,50" fill="${c}"/>`;
}
function renderElIconTeam(p) {
  const c = p.color || '#4f7df3';
  return `<circle cx="50" cy="50" r="46" fill="${c}" opacity="0.12"/>
    <circle cx="30" cy="34" r="10" fill="${c}"/>
    <circle cx="70" cy="34" r="10" fill="${c}"/>
    <circle cx="50" cy="22" r="12" fill="${c}"/>
    <path d="M 12,80 C 12,62 48,62 48,80 Z" fill="${c}"/>
    <path d="M 52,80 C 52,62 88,62 88,80 Z" fill="${c}"/>
    <path d="M 32,80 C 32,60 68,60 68,80 Z" fill="${c}"/>`;
}

/* ---------- shapes_basic ---------- */
function renderElCircleShape(p) {
  const c = p.color || '#4f7df3';
  return `<circle cx="50" cy="50" r="42" fill="${c}"/>`;
}
function renderElSquareShape(p) {
  const c = p.color || '#22c55e';
  return `<rect x="12" y="12" width="76" height="76" rx="10" fill="${c}"/>`;
}
function renderElTriangleShape(p) {
  const c = p.color || '#f59e0b';
  return `<polygon points="50,10 90,88 10,88" fill="${c}"/>`;
}
function renderElHexagonShape(p) {
  const c = p.color || '#4f9de0';
  const pts = [0, 1, 2, 3, 4, 5].map(i => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return `${(50 + Math.cos(a) * 44).toFixed(1)},${(50 + Math.sin(a) * 44).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${c}"/>`;
}
function renderElPentagonShape(p) {
  const c = p.color || '#e04f4f';
  const pts = [0, 1, 2, 3, 4].map(i => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return `${(50 + Math.cos(a) * 46).toFixed(1)},${(50 + Math.sin(a) * 46).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${c}"/>`;
}
function renderElOvalShape(p) {
  const c = p.color || '#a855f7';
  return `<ellipse cx="50" cy="50" rx="46" ry="30" fill="${c}"/>`;
}
function renderElDiamondShape(p) {
  const c = p.color || '#4f9de0';
  return `<polygon points="50,6 94,50 50,94 6,50" fill="${c}"/>`;
}
function renderElOctagonShape(p) {
  const c = p.color || '#e04f4f';
  const pts = [0, 1, 2, 3, 4, 5, 6, 7].map(i => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return `${(50 + Math.cos(a) * 44).toFixed(1)},${(50 + Math.sin(a) * 44).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${c}"/>`;
}
function renderElRhombusShape(p) {
  const c = p.color || '#22c55e';
  return `<polygon points="50,10 88,50 50,90 12,50" fill="${c}"/>`;
}
function renderElStarShape(p) {
  const c = p.color || '#f7c948';
  return `<polygon points="${_elStarPoints(50, 50, 6, 44, 20)}" fill="${c}"/>`;
}
function renderElCrossShape(p) {
  const c = p.color || '#4f7df3';
  return `<path d="M 38,6 L 62,6 L 62,38 L 94,38 L 94,62 L 62,62 L 62,94 L 38,94 L 38,62 L 6,62 L 6,38 L 38,38 Z" fill="${c}"/>`;
}
function renderElCrescentShape(p) {
  const c = p.color || '#a855f7';
  return `<path d="M 62,10 A 44,44 0 1 0 62,90 A 34,34 0 1 1 62,10 Z" fill="${c}"/>`;
}

/* ---------- shapes_decorative ---------- */
function renderElStarburstShape(p) {
  const c = p.color || '#f2b632';
  return `<polygon points="${_elStarPoints(50, 50, 10, 44, 24)}" fill="${c}"/>`;
}
function renderElBlobShape(p) {
  const c = p.color || '#a855f7';
  return `<path d="M 50,8 C 72,8 90,24 92,46 C 94,66 78,86 56,92 C 34,98 10,84 8,60 C 6,38 26,8 50,8 Z" fill="${c}"/>`;
}
function renderElWaveShape(p) {
  const c = p.color || '#22c55e';
  return `<path d="M 4,60 C 20,40 36,80 52,60 C 68,40 84,80 96,60 L 96,90 L 4,90 Z" fill="${c}"/>`;
}
function renderElDottedLineShape(p) {
  const c = p.color || '#8a8f9c';
  let dots = '';
  for (let i = 0; i < 10; i++) {
    dots += `<circle cx="${6 + i * 10}" cy="50" r="4" fill="${c}"/>`;
  }
  return dots;
}
function renderElZigzagShape(p) {
  const c = p.color || '#4f7df3';
  return `<polyline points="4,30 24,70 44,30 64,70 84,30 96,50" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function renderElConfettiBurst(p) {
  const c1 = p.color || '#f2b632';
  const c2 = p.color2 || '#e04f4f';
  const palette = [c1, c2, '#22c55e', '#4f7df3', '#a855f7'];
  let pieces = '';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 20 + (i % 3) * 14;
    const x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
    const deg = (a * 180 / Math.PI).toFixed(1);
    const col = palette[i % palette.length];
    pieces += `<rect x="${(x - 4).toFixed(1)}" y="${(y - 2).toFixed(1)}" width="8" height="4" fill="${col}" transform="rotate(${deg} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  return pieces;
}
function renderElSpiralShape(p) {
  const c = p.color || '#a855f7';
  let d = 'M 50,50 ';
  for (let i = 0; i < 60; i++) {
    const a = i * 0.35;
    const r = i * 0.72;
    d += `L ${(50 + Math.cos(a) * r).toFixed(1)},${(50 + Math.sin(a) * r).toFixed(1)} `;
  }
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
}
function renderElBurstLines(p) {
  const c = p.color || '#e04f4f';
  let lines = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = 14, r2 = 44;
    lines += `<line x1="${(50 + Math.cos(a) * r1).toFixed(1)}" y1="${(50 + Math.sin(a) * r1).toFixed(1)}" x2="${(50 + Math.cos(a) * r2).toFixed(1)}" y2="${(50 + Math.sin(a) * r2).toFixed(1)}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
  }
  return lines;
}
function renderElChevronShape(p) {
  const c = p.color || '#4f7df3';
  return `<polyline points="10,30 50,60 90,30" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="10,52 50,82 90,52" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`;
}
function renderElDotsCluster(p) {
  const c = p.color || '#8a8f9c';
  const pts = [[20,30],[34,20],[48,32],[62,22],[76,34],[28,50],[42,52],[56,50],[70,56],[84,48],[22,70],[36,72],[50,66],[64,74],[78,70]];
  return pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${c}"/>`).join('');
}
function renderElSplashShape(p) {
  const c = p.color || '#4f9de0';
  return `<path d="M 50,8 C 56,24 62,26 74,20 C 72,34 76,40 92,44 C 78,52 74,58 80,72 C 66,70 58,74 52,90 C 46,74 38,70 24,72 C 30,58 26,52 12,44 C 28,40 32,34 30,20 C 42,26 46,24 50,8 Z" fill="${c}"/>`;
}
function renderElRibbonShape(p) {
  const c = p.color || '#f28ba8';
  const c2 = p.color2 || '#ffffff';
  return `<path d="M 50,10 C 70,10 86,26 86,46 C 86,74 66,92 50,92 C 34,92 14,74 14,46 C 14,26 30,10 50,10 Z" fill="${c}"/>
    <path d="M 30,14 L 50,50 L 70,14 C 60,20 40,20 30,14 Z" fill="${c2}" opacity="0.6"/>
    <path d="M 30,86 L 50,50 L 70,86 C 60,80 40,80 30,86 Z" fill="${c2}" opacity="0.6"/>`;
}

/* ---------- backgrounds_scenic ---------- */
function renderElWaveBandStack(p) {
  const c1 = p.color || '#e0c3fc';
  const c2 = p.color2 || '#8ec5fc';
  const c3 = p.color3 || '#d3f8e2';
  const c4 = p.color4 || '#faf3c0';
  const c5 = p.color5 || '#f7b8c4';
  return `<rect x="-10" y="-10" width="120" height="120" fill="${c1}"/>
    <path d="M -10,26 C 6,14 18,34 32,24 C 46,14 54,32 68,24 C 82,16 92,30 110,20 L 110,120 L -10,120 Z" fill="${c2}"/>
    <path d="M -10,46 C 8,34 20,52 34,42 C 48,32 58,50 72,42 C 84,35 94,48 110,40 L 110,120 L -10,120 Z" fill="${c3}"/>
    <path d="M -10,66 C 10,54 22,70 36,62 C 50,54 60,70 74,62 C 86,56 96,68 110,60 L 110,120 L -10,120 Z" fill="${c4}"/>
    <path d="M -10,86 C 12,76 24,90 38,82 C 52,74 62,88 76,82 C 88,76 98,86 110,80 L 110,120 L -10,120 Z" fill="${c5}"/>`;
}
function renderElBlobCluster(p) {
  const c1 = p.color || '#a8ddd0';
  const c2 = p.color2 || '#f6d3a8';
  const c3 = p.color3 || '#c9c3f0';
  return `<path d="M -10,-10 L 28,-10 C 34,4 30,18 20,24 C 8,30 -6,22 -10,10 Z" fill="${c1}"/>
    <path d="M 68,-10 L 110,-10 L 110,20 C 100,30 84,26 78,14 C 73,4 70,-4 68,-10 Z" fill="${c2}"/>
    <path d="M -10,72 C 10,60 28,78 46,70 C 64,62 78,80 96,72 C 104,68 108,70 110,74 L 110,110 L -10,110 Z" fill="${c3}"/>`;
}
function renderElDotGridTexture(p) {
  const c = p.color || '#ffffff';
  let dots = '';
  for (let gy = 4; gy <= 100; gy += 9) {
    for (let gx = 4; gx <= 100; gx += 9) {
      dots += `<circle cx="${gx}" cy="${gy}" r="1.1" fill="${c}"/>`;
    }
  }
  return dots;
}
function renderElLowPolyMosaic(p) {
  const c1 = p.color || '#5ad1e0';
  const c2 = p.color2 || '#2f6fb3';
  const c3 = p.color3 || '#1a3e73';
  return `<rect x="-10" y="-10" width="120" height="120" fill="${c3}"/>
    <polygon points="-10,-10 55,-10 -10,55" fill="${c1}"/>
    <polygon points="-10,55 -10,90 25,60" fill="${c2}"/>
    <polygon points="-10,90 -10,120 40,95" fill="${c1}" opacity="0.85"/>
    <polygon points="25,60 -10,90 40,95 55,68" fill="${c2}" opacity="0.9"/>
    <polygon points="55,-10 30,25 70,10" fill="${c2}" opacity="0.8"/>
    <polygon points="30,25 55,68 70,10" fill="${c1}" opacity="0.7"/>`;
}
let _elGlowIdCounter = 0;
function renderElRadialGlowOrb(p) {
  const c = p.color || '#eaf6f6';
  const id = 'elglow' + (_elGlowIdCounter++);
  return `<defs><filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter></defs>
    <circle cx="50" cy="50" r="34" fill="${c}" filter="url(#${id})"/>`;
}
function renderElGradientMesh(p) {
  const c1 = p.color || '#c8b6ff';
  const c2 = p.color2 || '#a8ddd0';
  const c3 = p.color3 || '#fbc2eb';
  return `<defs>
    <radialGradient id="elmesh1" cx="20%" cy="20%" r="70%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></radialGradient>
    <radialGradient id="elmesh2" cx="80%" cy="30%" r="70%"><stop offset="0%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/></radialGradient>
    <radialGradient id="elmesh3" cx="50%" cy="85%" r="75%"><stop offset="0%" stop-color="${c3}"/><stop offset="100%" stop-color="${c3}" stop-opacity="0"/></radialGradient>
  </defs>
    <rect x="-10" y="-10" width="120" height="120" fill="#ffffff"/>
    <rect x="-10" y="-10" width="120" height="120" fill="url(#elmesh1)"/>
    <rect x="-10" y="-10" width="120" height="120" fill="url(#elmesh2)"/>
    <rect x="-10" y="-10" width="120" height="120" fill="url(#elmesh3)"/>`;
}
function renderElTriangleGrid(p) {
  const c1 = p.color || '#f2b632';
  const c2 = p.color2 || '#e0c3fc';
  const c3 = p.color3 || '#8ec5fc';
  let triangles = '';
  const colors = [c1, c2, c3];
  for (let y = 0; y < 110; y += 20) {
    for (let x = 0; x < 110; x += 20) {
      const col = colors[((x / 20) + (y / 20)) % 3];
      triangles += `<polygon points="${x - 10},${y - 10} ${x + 10},${y - 10} ${x},${y + 10}" fill="${col}" opacity="0.85"/>`;
    }
  }
  return triangles;
}
function renderElCircleScatter(p) {
  const c = p.color || '#4f9de0';
  const c2 = p.color2 || '#bfe3f5';
  const pts = [[10,20,18],[45,10,12],[80,18,22],[20,60,26],[60,55,16],[92,70,14],[14,90,20],[55,90,18],[80,95,16]];
  return pts.map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 === 0 ? c : c2}" opacity="0.75"/>`).join('');
}
function renderElDiagonalStripes(p) {
  const c1 = p.color || '#e0c3fc';
  const c2 = p.color2 || '#8ec5fc';
  return `<rect x="-10" y="-10" width="120" height="120" fill="${c2}"/>
    ${[0,1,2,3,4].map(i => `<polygon points="${-10 + i * 28},-10 ${-10 + i * 28 + 14},-10 ${-10 + i * 28 - 26},120 ${-10 + i * 28 - 40},120" fill="${c1}" opacity="0.85"/>`).join('')}`;
}
function renderElSoftGradientWash(p) {
  const c1 = p.color || '#fbc2eb';
  const c2 = p.color2 || '#a6c1ee';
  const c3 = p.color3 || '#fed7d7';
  return `<defs>
    <linearGradient id="elwash1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="50%" stop-color="${c3}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
    <rect x="-10" y="-10" width="120" height="120" fill="url(#elwash1)"/>`;
}

/* ---------- people_parts ---------- */
function renderElHandPointing(p) {
  const c = p.color || '#e8b48a';
  return `<path d="M 30,90 C 20,90 16,78 20,66 L 20,40 C 20,34 28,34 28,40 L 28,58
           L 32,58 L 32,30 C 32,24 42,24 42,30 L 42,58 L 46,58 L 46,26 C 46,20 56,20 56,26 L 56,58
           L 60,58 L 60,20 C 60,12 72,12 72,22 L 72,64 C 72,80 62,90 48,90 Z" fill="${c}"/>`;
}
function renderElEye(p) {
  const c = p.color || '#2b2b40';
  const iris = p.color2 || '#4f9de0';
  return `<path d="M 6,50 C 22,20 78,20 94,50 C 78,80 22,80 6,50 Z" fill="#ffffff" stroke="${c}" stroke-width="4"/>
    <circle cx="50" cy="50" r="18" fill="${iris}"/>
    <circle cx="50" cy="50" r="8" fill="${c}"/>
    <circle cx="44" cy="44" r="3" fill="#ffffff"/>`;
}
function renderElSpeechBubble(p) {
  const c = p.color || '#4f7df3';
  return `<path d="M 10,20 C 10,12 18,8 26,8 L 74,8 C 84,8 90,14 90,24 L 90,58 C 90,68 84,74 74,74
           L 40,74 L 20,92 L 24,74 L 26,74 C 16,74 10,66 10,56 Z" fill="${c}"/>`;
}
function renderElThoughtBubble(p) {
  const c = p.color || '#a855f7';
  return `<ellipse cx="54" cy="36" rx="36" ry="26" fill="${c}"/>
    <circle cx="24" cy="66" r="10" fill="${c}"/>
    <circle cx="14" cy="84" r="6" fill="${c}"/>`;
}
function renderElHandThumbsUp(p) {
  const c = p.color || '#e8b48a';
  return `<rect x="20" y="48" width="20" height="44" rx="5" fill="${c}"/>
    <path d="M 40,92 L 40,52 C 40,52 44,44 48,32 C 52,20 60,14 68,18 C 74,22 70,34 62,42 L 86,42 C 92,42 92,54 86,54 L 62,54 L 62,64 L 80,64 C 86,64 86,74 80,74 L 62,74 L 62,82 L 72,82 C 78,82 78,90 72,90 Z" fill="${c}"/>`;
}
function renderElFootprint(p) {
  const c = p.color || '#4f9de0';
  return `<ellipse cx="50" cy="60" rx="20" ry="32" fill="${c}"/>
    <circle cx="30" cy="20" r="6" fill="${c}"/>
    <circle cx="44" cy="12" r="6" fill="${c}"/>
    <circle cx="58" cy="12" r="6" fill="${c}"/>
    <circle cx="70" cy="20" r="6" fill="${c}"/>`;
}
function renderElEar(p) {
  const c = p.color || '#e8b48a';
  return `<path d="M 30,24 C 30,10 50,4 62,14 C 78,26 78,48 68,62 C 58,76 44,74 42,88
           C 40,98 26,98 24,86 C 22,72 34,68 38,58 C 42,48 36,42 36,34" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <path d="M 42,30 C 42,22 54,20 58,28" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" opacity="0.7"/>`;
}
function renderElMouthSmile(p) {
  const c = p.color || '#e04f4f';
  return `<path d="M 8,36 C 24,80 76,80 92,36 Z" fill="${c}"/>
    <path d="M 20,44 L 26,42 M 34,48 L 40,45 M 50,50 L 56,48" stroke="#ffffff" stroke-width="3" opacity="0.6" stroke-linecap="round"/>`;
}

/* ---------- science ---------- */
function renderElFlask(p) {
  const glass = p.color || '#4f9de0';
  const liquid = p.color2 || '#22c55e';
  return `<path d="M 42,8 L 58,8 L 58,38 L 82,84 C 86,92 80,96 72,96 L 28,96 C 20,96 14,92 18,84 L 42,38 Z"
           fill="none" stroke="${glass}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M 30,68 L 70,68 L 80,88 C 82,92 78,94 72,94 L 28,94 C 22,94 18,92 20,88 Z" fill="${liquid}"/>
    <rect x="38" y="6" width="24" height="8" rx="2" fill="${glass}"/>`;
}
function renderElMagnet(p) {
  const c = p.color || '#e04f4f';
  const tip = p.color2 || '#e8ecf5';
  return `<path d="M 20,90 L 20,44 C 20,22 36,10 50,10 C 64,10 80,22 80,44 L 80,90 L 60,90 L 60,46
           C 60,36 55,30 50,30 C 45,30 40,36 40,46 L 40,90 Z" fill="${c}"/>
    <rect x="20" y="78" width="20" height="12" fill="${tip}"/>
    <rect x="60" y="78" width="20" height="12" fill="${tip}"/>`;
}
function renderElAtomIcon(p) {
  const c = p.color || '#4f7df3';
  return `<ellipse cx="50" cy="50" rx="44" ry="18" fill="none" stroke="${c}" stroke-width="4"/>
    <ellipse cx="50" cy="50" rx="44" ry="18" fill="none" stroke="${c}" stroke-width="4" transform="rotate(60 50 50)"/>
    <ellipse cx="50" cy="50" rx="44" ry="18" fill="none" stroke="${c}" stroke-width="4" transform="rotate(120 50 50)"/>
    <circle cx="50" cy="50" r="9" fill="${c}"/>`;
}
function renderElDnaStrand(p) {
  const c = p.color || '#a855f7';
  const c2 = p.color2 || '#4f9de0';
  let rungs = '';
  for (let i = 0; i < 5; i++) {
    const y = 12 + i * 19;
    const spread = 34 * Math.sin((i / 4) * Math.PI);
    const x1 = 50 + spread, x2 = 50 - spread;
    rungs += `<line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="${c}" stroke-width="2.5" opacity="0.6"/>
      <circle cx="${x1.toFixed(1)}" cy="${y}" r="4" fill="${c}"/>
      <circle cx="${x2.toFixed(1)}" cy="${y}" r="4" fill="${c2}"/>`;
  }
  return `<path d="M 50,4 C 20,26 80,44 50,50 C 20,56 80,74 50,96" fill="none" stroke="${c}" stroke-width="4"/>
    <path d="M 50,4 C 80,26 20,44 50,50 C 80,56 20,74 50,96" fill="none" stroke="${c2}" stroke-width="4"/>
    ${rungs}`;
}
function renderElTestTube(p) {
  const c = p.color || '#4f9de0';
  const liquid = p.color2 || '#22c55e';
  return `<path d="M 38,10 L 38,80 C 38,90 46,96 50,96 C 54,96 62,90 62,80 L 62,10 Z" fill="none" stroke="${c}" stroke-width="5"/>
    <path d="M 38,60 L 62,60 L 62,80 C 62,90 54,94 50,94 C 46,94 38,90 38,80 Z" fill="${liquid}"/>
    <rect x="34" y="4" width="32" height="8" rx="2" fill="${c}"/>`;
}
function renderElMicroscopeScience(p) {
  const c = p.color || '#4a5568';
  const lens = p.color2 || '#bfe3f5';
  return `<rect x="16" y="86" width="68" height="8" rx="3" fill="${c}"/>
    <path d="M 50,20 C 44,20 38,26 38,32 L 38,60 L 62,60 L 62,32 C 62,26 56,20 50,20 Z" fill="${c}"/>
    <circle cx="50" cy="32" r="8" fill="${lens}"/>
    <rect x="30" y="60" width="46" height="10" rx="2" fill="${c}"/>
    <rect x="40" y="70" width="12" height="18" fill="${c}"/>`;
}
function renderElPetriDish(p) {
  const c = p.color || '#bfe3f5';
  const dot = p.color2 || '#4f9de0';
  return `<ellipse cx="50" cy="60" rx="42" ry="22" fill="${c}" opacity="0.55"/>
    <ellipse cx="50" cy="60" rx="42" ry="22" fill="none" stroke="#8ab4d9" stroke-width="3"/>
    <ellipse cx="50" cy="52" rx="42" ry="14" fill="${c}" opacity="0.4"/>
    <circle cx="34" cy="58" r="4" fill="${dot}"/>
    <circle cx="56" cy="60" r="3" fill="${dot}"/>
    <circle cx="68" cy="56" r="3.5" fill="${dot}"/>`;
}
function renderElThermometerScience(p) {
  const c = p.color || '#e04f4f';
  const body = p.color2 || '#ffffff';
  return `<rect x="42" y="6" width="16" height="66" rx="8" fill="${body}" stroke="#8a8f9c" stroke-width="3"/>
    <circle cx="50" cy="82" r="12" fill="${c}"/>
    <rect x="46" y="36" width="8" height="46" fill="${c}"/>
    ${[0,1,2,3,4].map(i => `<line x1="58" y1="${18 + i * 12}" x2="70" y2="${18 + i * 12}" stroke="#8a8f9c" stroke-width="2"/>`).join('')}`;
}

/* ---------- finance ---------- */
function renderElCoin(p) {
  const c = p.color || '#f2b632';
  const rim = p.color2 || '#c99a10';
  return `<circle cx="50" cy="50" r="42" fill="${c}" stroke="${rim}" stroke-width="5"/>
    <circle cx="50" cy="50" r="30" fill="none" stroke="${rim}" stroke-width="3"/>
    <text x="50" y="61" font-size="34" font-family="Georgia, serif" text-anchor="middle" fill="${rim}">$</text>`;
}
function renderElWallet(p) {
  const c = p.color || '#6d4a2f';
  const c2 = p.color2 || '#f2b632';
  return `<rect x="8" y="26" width="84" height="58" rx="8" fill="${c}"/>
    <path d="M 8,40 L 92,40 L 92,34 C 92,30 88,26 84,26 L 16,26 C 12,26 8,30 8,34 Z" fill="${c}" opacity="0.85"/>
    <circle cx="72" cy="55" r="8" fill="${c2}"/>`;
}
function renderElPiggyBank(p) {
  const c = p.color || '#f28ba8';
  return `<ellipse cx="50" cy="58" rx="42" ry="30" fill="${c}"/>
    <circle cx="80" cy="46" r="10" fill="${c}"/>
    <polygon points="18,40 8,30 22,32" fill="${c}"/>
    <rect x="42" y="20" width="16" height="8" rx="3" fill="${c}"/>
    <circle cx="30" cy="56" r="4" fill="#3d2b1f"/>
    <rect x="60" y="82" width="8" height="12" rx="2" fill="${c}"/>
    <rect x="32" y="82" width="8" height="12" rx="2" fill="${c}"/>`;
}
function renderElGrowthArrow(p) {
  const c = p.color || '#22c55e';
  return `<polyline points="8,84 32,58 48,72 92,20" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <polygon points="92,20 70,24 88,40" fill="${c}"/>`;
}
function renderElBankBuilding(p) {
  const c = p.color || '#4a5568';
  const roof = p.color2 || '#f2b632';
  return `<polygon points="50,8 90,30 10,30" fill="${roof}"/>
    <rect x="14" y="30" width="72" height="6" fill="${roof}"/>
    ${[0,1,2,3].map(i => `<rect x="${18 + i * 18}" y="40" width="10" height="40" fill="${c}"/>`).join('')}
    <rect x="8" y="80" width="84" height="10" rx="2" fill="${c}"/>`;
}
function renderElCreditCard(p) {
  const c = p.color || '#4f7df3';
  const chip = p.color2 || '#f2b632';
  return `<rect x="6" y="24" width="88" height="54" rx="6" fill="${c}"/>
    <rect x="6" y="34" width="88" height="8" fill="#2b2b40" opacity="0.6"/>
    <rect x="16" y="50" width="18" height="14" rx="3" fill="${chip}"/>
    <line x1="16" y1="72" x2="66" y2="72" stroke="#ffffff" stroke-width="3" opacity="0.7"/>
    <line x1="16" y1="66" x2="46" y2="66" stroke="#ffffff" stroke-width="3" opacity="0.7"/>`;
}
function renderElReceipt(p) {
  const c = p.color || '#ffffff';
  const line = p.color2 || '#8a8f9c';
  return `<path d="M 20,6 L 80,6 L 80,92 L 76,88 L 72,92 L 68,88 L 64,92 L 60,88 L 56,92 L 52,88 L 48,92 L 44,88 L 40,92 L 36,88 L 32,92 L 28,88 L 24,92 L 20,88 Z" fill="${c}" stroke="${line}" stroke-width="2"/>
    <line x1="30" y1="24" x2="70" y2="24" stroke="${line}" stroke-width="2"/>
    <line x1="30" y1="36" x2="70" y2="36" stroke="${line}" stroke-width="2"/>
    <line x1="30" y1="48" x2="60" y2="48" stroke="${line}" stroke-width="2"/>
    <line x1="30" y1="60" x2="70" y2="60" stroke="${line}" stroke-width="2"/>
    <line x1="30" y1="72" x2="56" y2="72" stroke="${line}" stroke-width="2"/>`;
}
function renderElMoneyBag(p) {
  const c = p.color || '#d9a441';
  const tie = p.color2 || '#6d4a2f';
  return `<path d="M 26,30 C 22,54 14,70 14,80 C 14,92 30,98 50,98 C 70,98 86,92 86,80 C 86,70 78,54 74,30 Z" fill="${c}"/>
    <path d="M 30,20 L 70,20 L 66,30 L 34,30 Z" fill="${tie}"/>
    <rect x="34" y="16" width="32" height="8" rx="3" fill="${tie}"/>
    <text x="50" y="72" font-size="26" font-family="Georgia, serif" text-anchor="middle" fill="${tie}">$</text>`;
}

/* ---------- health ---------- */
function renderElHeartIcon(p) {
  const c = p.color || '#e04f4f';
  return `<path d="M 50,90 C 20,68 6,48 6,30 C 6,14 20,4 34,4 C 42,4 48,8 50,16
           C 52,8 58,4 66,4 C 80,4 94,14 94,30 C 94,48 80,68 50,90 Z" fill="${c}"/>`;
}
function renderElPill(p) {
  const c = p.color || '#4f9de0';
  const c2 = p.color2 || '#ffffff';
  return `<rect x="10" y="34" width="80" height="32" rx="16" fill="${c2}"/>
    <path d="M 26,34 L 50,34 L 50,66 L 26,66 C 16,66 10,58 10,50 C 10,42 16,34 26,34 Z" fill="${c}"/>`;
}
function renderElStethoscope(p) {
  const c = p.color || '#4a5568';
  return `<path d="M 24,10 L 24,40 C 24,56 36,64 48,64 C 60,64 72,56 72,40 L 72,10" fill="none" stroke="${c}" stroke-width="5"/>
    <circle cx="24" cy="8" r="6" fill="${c}"/>
    <circle cx="72" cy="8" r="6" fill="${c}"/>
    <line x1="48" y1="64" x2="48" y2="78" stroke="${c}" stroke-width="5"/>
    <circle cx="48" cy="86" r="10" fill="none" stroke="${c}" stroke-width="5"/>`;
}
function renderElBandage(p) {
  const c = p.color || '#f2d9b8';
  const dot = p.color2 || '#e04f4f';
  return `<g transform="rotate(-30 50 50)">
    <rect x="12" y="38" width="76" height="24" rx="12" fill="${c}"/>
    <rect x="30" y="38" width="16" height="24" fill="#ffffff"/>
    <rect x="54" y="38" width="16" height="24" fill="#ffffff"/>
    <circle cx="38" cy="46" r="1.6" fill="${dot}"/>
    <circle cx="38" cy="54" r="1.6" fill="${dot}"/>
    <circle cx="62" cy="46" r="1.6" fill="${dot}"/>
    <circle cx="62" cy="54" r="1.6" fill="${dot}"/>
  </g>`;
}
function renderElSyringe(p) {
  const c = p.color || '#8a8f9c';
  const liquid = p.color2 || '#4f9de0';
  return `<g transform="rotate(-30 50 50)">
    <rect x="20" y="42" width="56" height="16" fill="${liquid}"/>
    <rect x="20" y="42" width="56" height="16" fill="none" stroke="${c}" stroke-width="2"/>
    <line x1="76" y1="50" x2="94" y2="50" stroke="${c}" stroke-width="3"/>
    <rect x="10" y="40" width="10" height="20" rx="2" fill="${c}"/>
    <rect x="0" y="44" width="10" height="12" rx="2" fill="${c}"/>
    <line x1="30" y1="42" x2="30" y2="58" stroke="${c}" stroke-width="1.5"/>
    <line x1="40" y1="42" x2="40" y2="58" stroke="${c}" stroke-width="1.5"/>
    <line x1="50" y1="42" x2="50" y2="58" stroke="${c}" stroke-width="1.5"/>
    <line x1="60" y1="42" x2="60" y2="58" stroke="${c}" stroke-width="1.5"/>
  </g>`;
}
function renderElThermometerHealth(p) {
  const c = p.color || '#e04f4f';
  const body = p.color2 || '#ffffff';
  return `<rect x="42" y="6" width="16" height="70" rx="8" fill="${body}" stroke="#8a8f9c" stroke-width="3"/>
    <circle cx="50" cy="86" r="12" fill="${c}"/>
    <rect x="46" y="30" width="8" height="56" fill="${c}"/>
    <circle cx="50" cy="20" r="4" fill="${c}"/>`;
}
function renderElFirstAidKit(p) {
  const c = p.color || '#e04f4f';
  const cross = p.color2 || '#ffffff';
  return `<rect x="10" y="30" width="80" height="56" rx="8" fill="${c}"/>
    <path d="M 36,30 L 36,20 C 36,14 64,14 64,20 L 64,30" fill="none" stroke="${c}" stroke-width="6"/>
    <rect x="44" y="44" width="12" height="30" fill="${cross}"/>
    <rect x="35" y="53" width="30" height="12" fill="${cross}"/>`;
}
function renderElWheelchair(p) {
  const c = p.color || '#4a5568';
  const wheel = p.color2 || '#2b2b40';
  return `<circle cx="42" cy="70" r="24" fill="none" stroke="${wheel}" stroke-width="5"/>
    <circle cx="42" cy="70" r="20" fill="none" stroke="${wheel}" stroke-width="1.5"/>
    <path d="M 42,46 L 42,20 L 60,20 L 60,46 L 78,46 L 78,54 L 60,54 L 60,64" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="80" cy="80" r="8" fill="none" stroke="${wheel}" stroke-width="3"/>`;
}

/* ---------- food ---------- */
function renderElCoffeeCup(p) {
  const c = p.color || '#6d4a2f';
  const c2 = p.color2 || '#ffffff';
  return `<path d="M 20,36 L 74,36 L 70,80 C 69,88 62,92 54,92 L 40,92 C 32,92 25,88 24,80 Z" fill="${c2}" stroke="${c}" stroke-width="4"/>
    <path d="M 30,46 L 64,46 L 61,78 C 60,84 55,86 50,86 L 44,86 C 39,86 34,84 33,78 Z" fill="${c}"/>
    <path d="M 74,44 C 88,44 88,66 74,66" fill="none" stroke="${c}" stroke-width="5"/>`;
}
function renderElAppleFruit(p) {
  const c = p.color || '#e04f4f';
  return `<path d="M 50,30 C 30,18 8,32 8,56 C 8,76 26,94 42,94 C 46,94 48,92 50,92 C 52,92 54,94 58,94
           C 74,94 92,76 92,56 C 92,32 70,18 50,30 Z" fill="${c}"/>
    <path d="M 50,30 C 48,20 50,10 60,6" fill="none" stroke="#5c3a22" stroke-width="4" stroke-linecap="round"/>
    <path d="M 50,14 C 58,8 66,10 68,16 C 60,20 52,18 50,14 Z" fill="#4f9d5c"/>`;
}
function renderElPizzaSlice(p) {
  const crust = p.color2 || '#f2b632';
  const cheese = p.color || '#f5d76e';
  return `<path d="M 50,8 L 90,88 C 65,98 35,98 10,88 Z" fill="${cheese}"/>
    <path d="M 10,88 L 90,88 C 92,92 90,96 84,96 L 16,96 C 10,96 8,92 10,88 Z" fill="${crust}"/>
    <circle cx="50" cy="40" r="6" fill="#e04f4f"/>
    <circle cx="34" cy="58" r="5" fill="#e04f4f"/>
    <circle cx="64" cy="62" r="5" fill="#e04f4f"/>`;
}
function renderElBurger(p) {
  const bun = p.color || '#d9a441';
  const lettuce = p.color2 || '#22c55e';
  return `<path d="M 10,40 C 10,20 32,10 50,10 C 68,10 90,20 90,40 Z" fill="${bun}"/>
    <path d="M 8,44 C 20,50 30,42 40,48 C 50,54 60,46 70,48 C 80,50 90,46 92,44 L 92,50 L 8,50 Z" fill="${lettuce}"/>
    <rect x="8" y="50" width="84" height="8" fill="#6d4a2f"/>
    <rect x="8" y="58" width="84" height="6" fill="#f2b632"/>
    <rect x="8" y="64" width="84" height="6" fill="#e04f4f"/>
    <path d="M 10,70 L 90,70 C 90,84 74,92 50,92 C 26,92 10,84 10,70 Z" fill="${bun}"/>`;
}
function renderElIceCream(p) {
  const cone = p.color2 || '#d9a441';
  const scoop = p.color || '#f28ba8';
  return `<polygon points="30,52 70,52 50,94" fill="${cone}"/>
    <line x1="34" y1="62" x2="66" y2="62" stroke="#a4703a" stroke-width="1.5"/>
    <line x1="40" y1="74" x2="60" y2="74" stroke="#a4703a" stroke-width="1.5"/>
    <circle cx="38" cy="40" r="14" fill="${scoop}"/>
    <circle cx="62" cy="40" r="14" fill="${scoop}"/>
    <circle cx="50" cy="28" r="14" fill="${scoop}"/>
    <circle cx="50" cy="14" r="4" fill="#e04f4f"/>`;
}
function renderElBreadLoaf(p) {
  const c = p.color || '#d9a441';
  const crust = p.color2 || '#8a5a2f';
  return `<path d="M 8,58 C 8,38 22,22 50,22 C 78,22 92,38 92,58 L 92,84 L 8,84 Z" fill="${c}"/>
    <path d="M 8,58 C 8,42 22,30 50,30 C 78,30 92,42 92,58" fill="none" stroke="${crust}" stroke-width="3"/>
    <line x1="34" y1="42" x2="30" y2="30" stroke="${crust}" stroke-width="2"/>
    <line x1="50" y1="38" x2="50" y2="26" stroke="${crust}" stroke-width="2"/>
    <line x1="66" y1="42" x2="70" y2="30" stroke="${crust}" stroke-width="2"/>`;
}

/* ---------- travel ---------- */
function renderElAirplane(p) {
  const c = p.color || '#4a5568';
  return `<g transform="rotate(45 50 50)">
    <path d="M 50,4 L 58,30 L 90,44 L 90,52 L 58,44 L 58,68 L 72,80 L 72,86 L 50,78 L 28,86 L 28,80 L 42,68 L 42,44 L 10,52 L 10,44 L 42,30 Z" fill="${c}"/>
  </g>`;
}
function renderElSuitcase(p) {
  const c = p.color || '#4f7df3';
  return `<rect x="10" y="30" width="80" height="58" rx="8" fill="${c}"/>
    <rect x="38" y="16" width="24" height="16" rx="4" fill="none" stroke="${c}" stroke-width="6"/>
    <rect x="10" y="52" width="80" height="10" fill="#ffffff" opacity="0.3"/>`;
}
function renderElMapPin(p) {
  const c = p.color || '#e04f4f';
  return `<path d="M 50,96 C 30,68 14,50 14,32 C 14,14 30,2 50,2 C 70,2 86,14 86,32 C 86,50 70,68 50,96 Z" fill="${c}"/>
    <circle cx="50" cy="32" r="14" fill="#ffffff"/>`;
}
function renderElGlobe(p) {
  const c = p.color || '#2f7d6a';
  return `<circle cx="50" cy="50" r="44" fill="none" stroke="${c}" stroke-width="4"/>
    <ellipse cx="50" cy="50" rx="20" ry="44" fill="none" stroke="${c}" stroke-width="3"/>
    <line x1="6" y1="50" x2="94" y2="50" stroke="${c}" stroke-width="3"/>
    <path d="M 12,30 C 30,40 70,40 88,30" fill="none" stroke="${c}" stroke-width="3"/>
    <path d="M 12,70 C 30,60 70,60 88,70" fill="none" stroke="${c}" stroke-width="3"/>`;
}
function renderElCompass(p) {
  const c = p.color || '#d9a441';
  const c2 = p.color2 || '#e04f4f';
  return `<circle cx="50" cy="50" r="42" fill="${c}" stroke="#8a5a2f" stroke-width="4"/>
    <circle cx="50" cy="50" r="36" fill="#f2d9b8"/>
    <polygon points="50,20 58,50 50,80 42,50" fill="${c2}"/>
    <polygon points="50,20 42,50 50,80 58,50" fill="#4a5568" opacity="0.85" transform="rotate(90 50 50)"/>
    <circle cx="50" cy="50" r="4" fill="#2b2b40"/>
    <text x="50" y="18" font-size="9" font-family="Georgia, serif" text-anchor="middle" fill="#2b2b40" font-weight="bold">N</text>`;
}
function renderElCameraTravel(p) {
  const c = p.color || '#2b2b40';
  const lens = p.color2 || '#4f9de0';
  return `<rect x="6" y="30" width="88" height="56" rx="8" fill="${c}"/>
    <rect x="34" y="16" width="24" height="16" rx="3" fill="${c}"/>
    <circle cx="50" cy="58" r="22" fill="${lens}"/>
    <circle cx="50" cy="58" r="13" fill="#1a1a2a"/>
    <circle cx="44" cy="52" r="3" fill="#ffffff" opacity="0.6"/>
    <rect x="76" y="38" width="10" height="6" rx="2" fill="#f5c518"/>`;
}
function renderElPassport(p) {
  const c = p.color || '#4a2c1e';
  const c2 = p.color2 || '#f2b632';
  return `<rect x="20" y="6" width="60" height="88" rx="4" fill="${c}"/>
    <rect x="26" y="12" width="48" height="76" fill="none" stroke="${c2}" stroke-width="2"/>
    <circle cx="50" cy="40" r="14" fill="none" stroke="${c2}" stroke-width="2"/>
    <path d="M 50,26 L 50,54 M 36,40 L 64,40" stroke="${c2}" stroke-width="1.5"/>
    <line x1="32" y1="66" x2="68" y2="66" stroke="${c2}" stroke-width="2"/>
    <line x1="32" y1="76" x2="60" y2="76" stroke="${c2}" stroke-width="2"/>`;
}
function renderElBeachUmbrella(p) {
  const c = p.color || '#e04f4f';
  const c2 = p.color2 || '#ffffff';
  return `<path d="M 6,42 C 6,18 30,4 50,4 C 70,4 94,18 94,42 L 6,42 Z" fill="${c}"/>
    <path d="M 50,4 L 50,42 L 26,42 C 26,22 36,8 50,4 Z" fill="${c2}"/>
    <path d="M 50,4 L 50,42 L 74,42 C 74,22 64,8 50,4 Z" fill="${c2}"/>
    <line x1="50" y1="4" x2="50" y2="96" stroke="#8a5a2f" stroke-width="4"/>`;
}

/* ---------- nature_plants ---------- */
function renderElLeaf(p) {
  const c = p.color || '#4f9d5c';
  return `<path d="M 50,94 C 20,80 10,44 42,10 C 74,44 80,80 50,94 Z" fill="${c}"/>
    <line x1="50" y1="94" x2="50" y2="20" stroke="#2f6b3c" stroke-width="3"/>`;
}
function renderElTreeSmall(p) {
  const foliage = p.color || '#2f7d4a';
  const trunk = p.color2 || '#6d4a2f';
  return `<rect x="44" y="60" width="12" height="34" fill="${trunk}"/>
    <circle cx="50" cy="42" r="26" fill="${foliage}"/>
    <circle cx="30" cy="54" r="18" fill="${foliage}"/>
    <circle cx="70" cy="54" r="18" fill="${foliage}"/>`;
}
function renderElFlower(p) {
  const petal = p.color || '#f28ba8';
  const center = p.color2 || '#f2b632';
  let petals = '';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cx = 50 + Math.cos(a) * 20, cy = 50 + Math.sin(a) * 20;
    const deg = (a * 180 / Math.PI).toFixed(1);
    petals += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="14" ry="9" fill="${petal}" transform="rotate(${deg} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
  }
  return `${petals}<circle cx="50" cy="50" r="13" fill="${center}"/>`;
}
function renderElCactus(p) {
  const c = p.color || '#2f7d4a';
  return `<rect x="42" y="30" width="16" height="64" rx="8" fill="${c}"/>
    <path d="M 42,50 L 22,50 L 22,36 L 30,36 L 30,42 L 42,42 Z" fill="${c}"/>
    <path d="M 58,66 L 78,66 L 78,80 L 70,80 L 70,74 L 58,74 Z" fill="${c}"/>
    <ellipse cx="50" cy="94" rx="26" ry="6" fill="#a4703a"/>`;
}
function renderElMushroom(p) {
  const cap = p.color || '#e04f4f';
  const stem = p.color2 || '#f2d9b8';
  return `<path d="M 10,48 C 10,22 30,8 50,8 C 70,8 90,22 90,48 Z" fill="${cap}"/>
    <circle cx="30" cy="30" r="4" fill="#ffffff" opacity="0.85"/>
    <circle cx="56" cy="22" r="5" fill="#ffffff" opacity="0.85"/>
    <circle cx="72" cy="34" r="4" fill="#ffffff" opacity="0.85"/>
    <rect x="40" y="48" width="20" height="42" rx="4" fill="${stem}"/>`;
}
function renderElFern(p) {
  const c = p.color || '#4f9d5c';
  let fronds = '';
  for (let i = 0; i < 5; i++) {
    const y = 20 + i * 15;
    const w = 26 - i * 3;
    fronds += `<ellipse cx="28" cy="${y}" rx="${w}" ry="4" fill="${c}" transform="rotate(-25 28 ${y})"/>
      <ellipse cx="72" cy="${y}" rx="${w}" ry="4" fill="${c}" transform="rotate(25 72 ${y})"/>`;
  }
  return `<line x1="50" y1="4" x2="50" y2="96" stroke="#2f6b3c" stroke-width="4"/>${fronds}`;
}
function renderElVine(p) {
  const c = p.color || '#2f7d4a';
  let leaves = '';
  const pts = [[24,20],[30,38],[22,56],[32,72],[44,86],[56,72],[66,56],[58,38],[64,20]];
  pts.forEach(([x, y]) => {
    leaves += `<ellipse cx="${x}" cy="${y}" rx="10" ry="6" fill="${c}" transform="rotate(-30 ${x} ${y})"/>`;
  });
  return `<path d="M 50,4 C 20,30 20,70 50,96" fill="none" stroke="${c}" stroke-width="3"/>
    <path d="M 50,4 C 80,30 80,70 50,96" fill="none" stroke="${c}" stroke-width="3"/>${leaves}`;
}
function renderElSunflower(p) {
  const petal = p.color || '#f2b632';
  const center = p.color2 || '#4a2c1e';
  let petals = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const cx = 50 + Math.cos(a) * 26, cy = 50 + Math.sin(a) * 26;
    const deg = (a * 180 / Math.PI).toFixed(1);
    petals += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="14" ry="6" fill="${petal}" transform="rotate(${deg} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
  }
  return `${petals}<circle cx="50" cy="50" r="16" fill="${center}"/>`;
}

/* ---------- arrows_flow ---------- */
function renderElArrowUp(p) {
  const c = p.color || '#4f7df3';
  return `<polygon points="50,4 90,44 68,44 68,96 32,96 32,44 10,44" fill="${c}"/>`;
}
function renderElArrowDown(p) {
  const c = p.color || '#e04f4f';
  return `<polygon points="50,96 10,56 32,56 32,4 68,4 68,56 90,56" fill="${c}"/>`;
}
function renderElArrowCurved(p) {
  const c = p.color || '#22c55e';
  return `<path d="M 10,70 C 10,30 50,10 82,24" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <polygon points="82,24 64,18 74,38" fill="${c}"/>`;
}
function renderElLoopArrow(p) {
  const c = p.color || '#4f7df3';
  return `<path d="M 50,10 A 40,40 0 1 1 12,50" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <polygon points="12,50 8,28 30,36" fill="${c}"/>`;
}
function renderElArrowLeft(p) {
  const c = p.color || '#4f7df3';
  return `<polygon points="50,4 10,44 32,44 32,96 68,96 68,44 90,44" fill="${c}"/>`;
}
function renderElArrowDiagonal(p) {
  const c = p.color || '#a855f7';
  return `<g transform="rotate(45 50 50)">
    <polygon points="50,4 90,44 68,44 68,96 32,96 32,44 10,44" fill="${c}"/>
  </g>`;
}
function renderElSplitArrow(p) {
  const c = p.color || '#22c55e';
  return `<path d="M 10,50 L 40,50" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <path d="M 40,50 C 60,50 60,20 90,20" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <path d="M 40,50 C 60,50 60,80 90,80" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <polygon points="90,20 74,12 78,28" fill="${c}"/>
    <polygon points="90,80 74,72 78,88" fill="${c}"/>`;
}
function renderElMergeArrow(p) {
  const c = p.color || '#f2b632';
  return `<path d="M 10,20 C 40,20 40,50 90,50" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <path d="M 10,80 C 40,80 40,50 90,50" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <polygon points="90,50 74,40 74,60" fill="${c}"/>`;
}

/* ---------- communication ---------- */
function renderElEnvelope(p) {
  const c = p.color || '#4f7df3';
  const c2 = p.color2 || '#ffffff';
  return `<rect x="6" y="20" width="88" height="60" rx="6" fill="${c}"/>
    <path d="M 6,24 L 50,58 L 94,24" fill="none" stroke="${c2}" stroke-width="5"/>`;
}
function renderElPhoneCall(p) {
  const c = p.color || '#22c55e';
  return `<path d="M 22,10 C 14,10 8,16 10,26 C 14,52 46,84 74,90 C 84,92 90,86 90,78 L 90,64
           C 90,60 88,58 84,56 L 66,50 C 62,48 58,50 56,54 L 50,64 C 40,58 30,48 24,38 L 34,32
           C 38,30 40,26 38,22 L 32,4 Z" fill="${c}"/>`;
}
function renderElBellNotification(p) {
  const c = p.color || '#f2b632';
  const dot = p.color2 || '#e04f4f';
  return `<path d="M 50,8 C 36,8 30,20 30,32 L 30,52 L 18,70 L 82,70 L 70,52 L 70,32 C 70,20 64,8 50,8 Z" fill="${c}"/>
    <path d="M 40,76 C 40,84 44,90 50,90 C 56,90 60,84 60,76 Z" fill="${c}"/>
    <circle cx="74" cy="20" r="10" fill="${dot}"/>`;
}
function renderElMegaphone(p) {
  const c = p.color || '#e04f4f';
  return `<path d="M 10,44 L 40,32 L 40,68 L 10,56 Z" fill="${c}"/>
    <path d="M 40,20 L 88,4 L 88,96 L 40,80 Z" fill="${c}"/>
    <rect x="16" y="56" width="10" height="24" rx="4" fill="${c}"/>`;
}
function renderElChatIcon(p) {
  const c = p.color || '#4f7df3';
  const c2 = p.color2 || '#ffffff';
  return `<rect x="6" y="16" width="60" height="44" rx="8" fill="${c}"/>
    <polygon points="16,60 16,80 36,60" fill="${c}"/>
    <circle cx="22" cy="38" r="3.5" fill="${c2}"/>
    <circle cx="36" cy="38" r="3.5" fill="${c2}"/>
    <circle cx="50" cy="38" r="3.5" fill="${c2}"/>
    <rect x="50" y="40" width="46" height="34" rx="6" fill="${c}" opacity="0.7"/>
    <polygon points="86,74 86,92 68,74" fill="${c}" opacity="0.7"/>`;
}
function renderElSignalTower(p) {
  const c = p.color || '#4a5568';
  const wave = p.color2 || '#e04f4f';
  return `<polygon points="42,90 58,90 54,20 46,20" fill="${c}"/>
    <line x1="46" y1="50" x2="54" y2="50" stroke="${c}" stroke-width="3"/>
    <line x1="48" y1="70" x2="52" y2="70" stroke="${c}" stroke-width="3"/>
    <circle cx="50" cy="14" r="4" fill="${wave}"/>
    <path d="M 30,20 A 26,20 0 0 1 70,20" fill="none" stroke="${wave}" stroke-width="3" stroke-linecap="round"/>
    <path d="M 22,10 A 36,30 0 0 1 78,10" fill="none" stroke="${wave}" stroke-width="3" stroke-linecap="round"/>`;
}
function renderElRadio(p) {
  const c = p.color || '#d9a441';
  const c2 = p.color2 || '#4a5568';
  return `<rect x="6" y="34" width="88" height="54" rx="6" fill="${c}"/>
    <circle cx="30" cy="62" r="16" fill="${c2}"/>
    <circle cx="30" cy="62" r="6" fill="#2b2b40"/>
    <line x1="56" y1="50" x2="86" y2="50" stroke="${c2}" stroke-width="4"/>
    <line x1="56" y1="64" x2="86" y2="64" stroke="${c2}" stroke-width="4"/>
    <line x1="56" y1="78" x2="74" y2="78" stroke="${c2}" stroke-width="4"/>
    <line x1="18" y1="34" x2="82" y2="4" stroke="${c2}" stroke-width="4" stroke-linecap="round"/>`;
}
function renderElSatelliteDish(p) {
  const c = p.color || '#c7d0dc';
  const c2 = p.color2 || '#4a5568';
  return `<path d="M 20,20 C 44,4 76,20 78,50 C 70,30 44,20 20,20 Z" fill="${c}" stroke="${c2}" stroke-width="3"/>
    <line x1="20" y1="20" x2="50" y2="50" stroke="${c2}" stroke-width="3"/>
    <circle cx="52" cy="52" r="6" fill="${c2}"/>
    <line x1="52" y1="58" x2="52" y2="90" stroke="${c2}" stroke-width="4"/>
    <line x1="36" y1="92" x2="68" y2="92" stroke="${c2}" stroke-width="4" stroke-linecap="round"/>`;
}

/* ---------- awards ---------- */
function renderElTrophy(p) {
  const c = p.color || '#f2b632';
  return `<path d="M 30,10 L 70,10 L 70,34 C 70,52 58,62 50,62 C 42,62 30,52 30,34 Z" fill="${c}"/>
    <path d="M 30,16 C 14,16 10,32 22,42 C 26,45 30,44 30,44" fill="none" stroke="${c}" stroke-width="5"/>
    <path d="M 70,16 C 86,16 90,32 78,42 C 74,45 70,44 70,44" fill="none" stroke="${c}" stroke-width="5"/>
    <rect x="44" y="62" width="12" height="16" fill="${c}"/>
    <rect x="30" y="86" width="40" height="10" rx="3" fill="${c}"/>
    <rect x="36" y="78" width="28" height="10" fill="${c}"/>`;
}
function renderElMedal(p) {
  const ribbon = p.color2 || '#e04f4f';
  const disc = p.color || '#f2b632';
  return `<polygon points="34,4 50,38 22,38" fill="${ribbon}"/>
    <polygon points="66,4 78,38 50,38" fill="${ribbon}" opacity="0.85"/>
    <circle cx="50" cy="66" r="30" fill="${disc}"/>
    <circle cx="50" cy="66" r="20" fill="none" stroke="#c99a10" stroke-width="3"/>
    <polygon points="50,54 54,64 65,64 56,71 59,82 50,75 41,82 44,71 35,64 46,64" fill="#c99a10"/>`;
}
function renderElRibbonBadge(p) {
  const c = p.color || '#4f7df3';
  return `<circle cx="50" cy="38" r="30" fill="${c}"/>
    <circle cx="50" cy="38" r="20" fill="#ffffff" opacity="0.25"/>
    <polygon points="30,60 30,96 50,84 70,96 70,60" fill="${c}"/>`;
}
function renderElCertificateIcon(p) {
  const c = p.color || '#4f7df3';
  const seal = p.color2 || '#f2b632';
  return `<rect x="8" y="10" width="84" height="60" rx="4" fill="#ffffff" stroke="${c}" stroke-width="4"/>
    <line x1="18" y1="26" x2="72" y2="26" stroke="${c}" stroke-width="3"/>
    <line x1="18" y1="38" x2="82" y2="38" stroke="${c}" stroke-width="3"/>
    <line x1="18" y1="50" x2="60" y2="50" stroke="${c}" stroke-width="3"/>
    <circle cx="74" cy="80" r="16" fill="${seal}"/>
    <polygon points="74,90 64,98 68,86" fill="${seal}"/>
    <polygon points="74,90 84,98 80,86" fill="${seal}"/>`;
}
function renderElCrown(p) {
  const c = p.color || '#f2b632';
  const jewel = p.color2 || '#e04f4f';
  return `<path d="M 10,80 L 16,30 L 32,50 L 50,20 L 68,50 L 84,30 L 90,80 Z" fill="${c}"/>
    <rect x="10" y="80" width="80" height="10" rx="2" fill="${c}"/>
    <circle cx="16" cy="28" r="4" fill="${jewel}"/>
    <circle cx="50" cy="18" r="5" fill="${jewel}"/>
    <circle cx="84" cy="28" r="4" fill="${jewel}"/>`;
}
function renderElStarLaurel(p) {
  const c = p.color || '#22c55e';
  const star = p.color2 || '#f2b632';
  let leaves = '';
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    const x = 50 + Math.cos(a) * 36, y = 60 + Math.sin(a) * 36;
    leaves += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="10" ry="5" fill="${c}" transform="rotate(${(a * 180 / Math.PI).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * Math.PI;
    const x = 50 + Math.cos(a) * 36, y = 60 + Math.sin(a) * 36;
    leaves += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="10" ry="5" fill="${c}" transform="rotate(${(a * 180 / Math.PI).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  return `${leaves}<polygon points="${_elStarPoints(50, 50, 5, 22, 9)}" fill="${star}"/>`;
}
function renderElPrizeRibbon(p) {
  const c = p.color || '#e04f4f';
  const c2 = p.color2 || '#f2b632';
  return `<circle cx="50" cy="50" r="26" fill="${c2}"/>
    <circle cx="50" cy="50" r="18" fill="none" stroke="${c}" stroke-width="3"/>
    <path d="M 26,32 L 6,10 L 24,14 L 30,6 L 44,26 Z" fill="${c}"/>
    <path d="M 74,32 L 94,10 L 76,14 L 70,6 L 56,26 Z" fill="${c}"/>
    <polygon points="42,68 30,96 50,88 70,96 58,68" fill="${c}"/>`;
}
function renderElAchievementBadge(p) {
  const c = p.color || '#f2b632';
  const c2 = p.color2 || '#4f7df3';
  return `<polygon points="${_elStarPoints(50, 50, 8, 46, 30)}" fill="${c}"/>
    <circle cx="50" cy="50" r="22" fill="${c2}"/>
    <polygon points="${_elStarPoints(50, 50, 5, 16, 7)}" fill="#ffffff"/>`;
}

/* ---------- sports ---------- */
function renderElSoccerBall(p) {
  const c = p.color || '#2b2b40';
  const base = p.color2 || '#ffffff';
  return `<circle cx="50" cy="50" r="44" fill="${base}" stroke="${c}" stroke-width="4"/>
    <polygon points="${_elStarPoints(50, 32, 5, 15, 7)}" fill="${c}"/>
    <path d="M 50,47 L 22,66 L 12,42 M 50,47 L 78,66 L 88,42 M 50,47 L 50,80" fill="none" stroke="${c}" stroke-width="3"/>
    <polygon points="22,66 12,90 40,94" fill="${c}"/>
    <polygon points="78,66 88,90 60,94" fill="${c}"/>`;
}
function renderElBasketball(p) {
  const c = p.color || '#d9734e';
  const line = p.color2 || '#2b2b40';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <line x1="50" y1="6" x2="50" y2="94" stroke="${line}" stroke-width="3"/>
    <line x1="6" y1="50" x2="94" y2="50" stroke="${line}" stroke-width="3"/>
    <path d="M 12,20 C 30,36 30,64 12,80" fill="none" stroke="${line}" stroke-width="3"/>
    <path d="M 88,20 C 70,36 70,64 88,80" fill="none" stroke="${line}" stroke-width="3"/>`;
}
function renderElTennisRacket(p) {
  const c = p.color || '#8a8f9c';
  const strings = p.color2 || '#eef3ea';
  return `<g transform="rotate(20 50 50)">
    <ellipse cx="50" cy="34" rx="30" ry="34" fill="none" stroke="${c}" stroke-width="6"/>
    <line x1="50" y1="4" x2="50" y2="64" stroke="${strings}" stroke-width="1.5"/>
    <line x1="26" y1="12" x2="26" y2="56" stroke="${strings}" stroke-width="1.5"/>
    <line x1="74" y1="12" x2="74" y2="56" stroke="${strings}" stroke-width="1.5"/>
    <line x1="22" y1="20" x2="78" y2="20" stroke="${strings}" stroke-width="1.5"/>
    <line x1="20" y1="36" x2="80" y2="36" stroke="${strings}" stroke-width="1.5"/>
    <line x1="22" y1="52" x2="78" y2="52" stroke="${strings}" stroke-width="1.5"/>
    <rect x="44" y="64" width="12" height="32" rx="5" fill="${c}"/>
  </g>`;
}
function renderElWhistle(p) {
  const c = p.color || '#f2b632';
  return `<circle cx="66" cy="50" r="26" fill="${c}"/>
    <circle cx="66" cy="50" r="10" fill="none" stroke="#c99a10" stroke-width="3"/>
    <rect x="6" y="40" width="34" height="20" rx="10" fill="${c}"/>
    <rect x="58" y="22" width="8" height="14" rx="3" fill="${c}"/>
    <circle cx="66" cy="66" r="3" fill="#c99a10"/>`;
}
function renderElRunningShoe(p) {
  const c = p.color || '#e04f4f';
  const sole = p.color2 || '#2b2b40';
  return `<path d="M 6,80 L 6,60 C 6,52 14,48 22,50 L 40,56 C 48,46 62,40 76,40 C 88,40 96,48 96,58
           L 96,72 C 96,76 92,80 88,80 Z" fill="${c}"/>
    <rect x="6" y="80" width="90" height="12" rx="4" fill="${sole}"/>
    <line x1="42" y1="54" x2="52" y2="46" stroke="#ffffff" stroke-width="3" opacity="0.6"/>
    <line x1="48" y1="60" x2="60" y2="50" stroke="#ffffff" stroke-width="3" opacity="0.6"/>`;
}
function renderElBaseball(p) {
  const c = p.color || '#ffffff';
  const line = p.color2 || '#e04f4f';
  return `<circle cx="50" cy="50" r="44" fill="${c}" stroke="#c7d0dc" stroke-width="3"/>
    <path d="M 18,20 C 32,34 32,66 18,80" fill="none" stroke="${line}" stroke-width="3" stroke-dasharray="4 4"/>
    <path d="M 82,20 C 68,34 68,66 82,80" fill="none" stroke="${line}" stroke-width="3" stroke-dasharray="4 4"/>`;
}
function renderElTennisBall(p) {
  const c = p.color || '#c9e04f';
  const line = p.color2 || '#ffffff';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <path d="M 14,30 C 34,42 34,58 14,70" fill="none" stroke="${line}" stroke-width="4"/>
    <path d="M 86,30 C 66,42 66,58 86,70" fill="none" stroke="${line}" stroke-width="4"/>`;
}
function renderElGolfClub(p) {
  const c = p.color || '#8a8f9c';
  const head = p.color2 || '#4a5568';
  return `<g transform="rotate(-25 50 50)">
    <rect x="47" y="4" width="6" height="70" fill="${c}"/>
    <path d="M 40,74 L 60,74 L 62,92 L 38,92 Z" fill="${head}"/>
    <circle cx="50" cy="82" r="3" fill="#ffffff"/>
  </g>`;
}
function renderElSwimmingGoggles(p) {
  const c = p.color || '#4f9de0';
  const glass = p.color2 || '#bfe3f5';
  return `<ellipse cx="30" cy="50" rx="20" ry="16" fill="${glass}" stroke="${c}" stroke-width="5"/>
    <ellipse cx="70" cy="50" rx="20" ry="16" fill="${glass}" stroke="${c}" stroke-width="5"/>
    <line x1="50" y1="50" x2="50" y2="50" stroke="${c}" stroke-width="5"/>
    <path d="M 10,44 C 4,42 -2,44 0,50 C 2,56 10,54 12,50" fill="none" stroke="${c}" stroke-width="4"/>
    <path d="M 90,44 C 96,42 102,44 100,50 C 98,56 90,54 88,50" fill="none" stroke="${c}" stroke-width="4"/>`;
}
function renderElBoxingGlove(p) {
  const c = p.color || '#e04f4f';
  const cuff = p.color2 || '#ffffff';
  return `<path d="M 14,40 C 14,20 34,10 54,14 C 76,18 88,34 84,54 C 82,68 72,74 60,74 L 30,74 C 20,74 14,60 14,40 Z" fill="${c}"/>
    <rect x="22" y="72" width="50" height="16" rx="4" fill="${cuff}"/>
    <path d="M 26,44 C 26,34 36,28 46,30" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.5"/>`;
}

/* ---------- music ---------- */
function renderElMusicalNote(p) {
  const c = p.color || '#2b2b40';
  return `<ellipse cx="26" cy="80" rx="16" ry="12" fill="${c}"/>
    <ellipse cx="66" cy="70" rx="16" ry="12" fill="${c}"/>
    <rect x="40" y="14" width="6" height="66" fill="${c}"/>
    <rect x="80" y="8" width="6" height="62" fill="${c}"/>
    <path d="M 40,14 C 56,10 80,16 80,8 L 80,26 C 80,34 56,28 40,32 Z" fill="${c}"/>`;
}
function renderElGuitar(p) {
  const body = p.color || '#d9a441';
  const neck = p.color2 || '#4a2c1e';
  return `<rect x="44" y="4" width="12" height="46" fill="${neck}"/>
    <rect x="42" y="4" width="16" height="8" fill="#2b2b40"/>
    <path d="M 50,42 C 26,42 16,58 20,72 C 24,86 40,96 50,96 C 60,96 76,86 80,72 C 84,58 74,42 50,42 Z" fill="${body}"/>
    <circle cx="50" cy="70" r="14" fill="#4a2c1e"/>
    <line x1="50" y1="4" x2="50" y2="70" stroke="#2b2b40" stroke-width="1" opacity="0.5"/>`;
}
function renderElDrum(p) {
  const shell = p.color || '#e04f4f';
  const skin = p.color2 || '#f2d9b8';
  return `<ellipse cx="50" cy="28" rx="38" ry="16" fill="${skin}" stroke="#2b2b40" stroke-width="3"/>
    <rect x="12" y="28" width="76" height="46" fill="${shell}"/>
    <ellipse cx="50" cy="74" rx="38" ry="16" fill="${shell}" opacity="0.8"/>
    <line x1="16" y1="30" x2="16" y2="72" stroke="#2b2b40" stroke-width="2" opacity="0.4"/>
    <line x1="84" y1="30" x2="84" y2="72" stroke="#2b2b40" stroke-width="2" opacity="0.4"/>`;
}
function renderElPianoKeys(p) {
  const white = p.color2 || '#ffffff';
  const black = p.color || '#2b2b40';
  let whites = '';
  for (let i = 0; i < 7; i++) {
    whites += `<rect x="${4 + i * 13.1}" y="10" width="12" height="80" fill="${white}" stroke="#c7d0dc" stroke-width="1.5"/>`;
  }
  let blacks = '';
  [0, 1, 3, 4, 5].forEach(i => {
    blacks += `<rect x="${4 + i * 13.1 + 8}" y="10" width="8" height="48" fill="${black}"/>`;
  });
  return whites + blacks;
}
function renderElMicrophone(p) {
  const c = p.color || '#4a5568';
  const grille = p.color2 || '#2b2b40';
  return `<rect x="34" y="4" width="32" height="48" rx="16" fill="${grille}"/>
    <line x1="38" y1="16" x2="62" y2="16" stroke="${c}" stroke-width="2" opacity="0.6"/>
    <line x1="38" y1="26" x2="62" y2="26" stroke="${c}" stroke-width="2" opacity="0.6"/>
    <line x1="38" y1="36" x2="62" y2="36" stroke="${c}" stroke-width="2" opacity="0.6"/>
    <path d="M 22,44 C 22,66 36,78 50,78 C 64,78 78,66 78,44" fill="none" stroke="${c}" stroke-width="5"/>
    <line x1="50" y1="78" x2="50" y2="92" stroke="${c}" stroke-width="5"/>
    <line x1="34" y1="94" x2="66" y2="94" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;
}
function renderElViolin(p) {
  const body = p.color || '#8a4a2f';
  const c2 = p.color2 || '#2b2b40';
  return `<rect x="46" y="4" width="8" height="34" fill="${c2}"/>
    <path d="M 50,36 C 34,36 28,48 30,58 C 32,66 40,70 42,74 C 40,80 32,84 34,92 C 36,98 44,98 50,98 C 56,98 64,98 66,92 C 68,84 60,80 58,74 C 60,70 68,66 70,58 C 72,48 66,36 50,36 Z" fill="${body}"/>
    <line x1="50" y1="4" x2="50" y2="88" stroke="${c2}" stroke-width="1.5"/>`;
}
function renderElTrumpet(p) {
  const c = p.color || '#f2b632';
  const c2 = p.color2 || '#c99a10';
  return `<path d="M 8,44 L 60,44 L 60,56 L 8,56 Z" fill="${c}"/>
    <circle cx="14" cy="50" r="12" fill="${c2}"/>
    <path d="M 60,32 L 82,20 L 82,80 L 60,68 Z" fill="${c}"/>
    <ellipse cx="86" cy="50" rx="6" ry="30" fill="${c2}"/>
    <rect x="30" y="40" width="4" height="20" fill="${c2}"/>
    <rect x="40" y="40" width="4" height="20" fill="${c2}"/>
    <rect x="50" y="40" width="4" height="20" fill="${c2}"/>`;
}
function renderElSaxophone(p) {
  const c = p.color || '#d9a441';
  const keys = p.color2 || '#2b2b40';
  return `<path d="M 30,10 L 56,10 L 56,26 C 56,44 76,50 76,70 C 76,86 62,96 48,94 C 34,92 26,80 26,66 C 26,56 34,50 40,44" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/>
    <circle cx="76" cy="72" r="14" fill="${c}"/>
    <circle cx="76" cy="72" r="6" fill="${keys}"/>`;
}
function renderElMusicStand(p) {
  const c = p.color || '#4a5568';
  const note = p.color2 || '#2b2b40';
  return `<rect x="22" y="6" width="56" height="34" rx="3" fill="${note}"/>
    <line x1="30" y1="16" x2="70" y2="16" stroke="#ffffff" stroke-width="2" opacity="0.7"/>
    <line x1="30" y1="24" x2="70" y2="24" stroke="#ffffff" stroke-width="2" opacity="0.7"/>
    <line x1="30" y1="32" x2="58" y2="32" stroke="#ffffff" stroke-width="2" opacity="0.7"/>
    <line x1="50" y1="40" x2="50" y2="76" stroke="${c}" stroke-width="5"/>
    <line x1="50" y1="76" x2="30" y2="96" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <line x1="50" y1="76" x2="70" y2="96" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;
}
function renderElSpeaker(p) {
  const c = p.color || '#2b2b40';
  const cone = p.color2 || '#4a5568';
  return `<rect x="14" y="6" width="72" height="88" rx="8" fill="${c}"/>
    <circle cx="50" cy="36" r="14" fill="${cone}"/>
    <circle cx="50" cy="72" r="18" fill="${cone}"/>
    <circle cx="50" cy="72" r="8" fill="#1a1a2a"/>
    <circle cx="50" cy="36" r="5" fill="#1a1a2a"/>`;
}

/* ---------- kitchen ---------- */
function renderElChefHat(p) {
  const c = p.color || '#ffffff';
  const band = p.color2 || '#c7d0dc';
  return `<path d="M 26,50 C 8,50 4,26 22,18 C 24,6 42,2 50,12 C 58,2 76,6 78,18 C 96,26 92,50 74,50 Z" fill="${c}" stroke="${band}" stroke-width="2"/>
    <rect x="26" y="48" width="48" height="28" fill="${c}" stroke="${band}" stroke-width="2"/>
    <rect x="22" y="76" width="56" height="14" rx="3" fill="${band}"/>`;
}
function renderElCookingPot(p) {
  const c = p.color || '#4a5568';
  const handle = p.color2 || '#2b2b40';
  return `<rect x="16" y="40" width="68" height="46" rx="6" fill="${c}"/>
    <ellipse cx="50" cy="40" rx="34" ry="8" fill="${c}"/>
    <rect x="0" y="52" width="18" height="8" rx="4" fill="${handle}"/>
    <rect x="82" y="52" width="18" height="8" rx="4" fill="${handle}"/>
    <path d="M 38,20 C 38,10 46,10 44,2 M 50,20 C 50,10 58,10 56,2 M 62,20 C 62,10 70,10 68,2" fill="none" stroke="#c7d0dc" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`;
}
function renderElForkKnife(p) {
  const c = p.color || '#8a8f9c';
  return `<g>
    <rect x="22" y="4" width="6" height="50" fill="${c}"/>
    <rect x="12" y="4" width="4" height="24" fill="${c}"/>
    <rect x="22" y="4" width="4" height="24" fill="${c}"/>
    <rect x="32" y="4" width="4" height="24" fill="${c}"/>
    <rect x="22" y="54" width="6" height="40" fill="${c}"/>
    <path d="M 66,4 C 78,4 84,16 76,28 L 72,50 L 64,50 L 68,28 C 60,16 66,4 66,4 Z" fill="${c}"/>
    <rect x="64" y="50" width="6" height="44" fill="${c}"/>
  </g>`;
}
function renderElKettle(p) {
  const c = p.color || '#4a5568';
  const handle = p.color2 || '#2b2b40';
  return `<path d="M 20,50 C 20,30 34,20 50,20 C 66,20 80,30 80,50 L 80,76 C 80,86 70,94 50,94 C 30,94 20,86 20,76 Z" fill="${c}"/>
    <path d="M 78,44 L 96,30 L 92,52 L 78,54 Z" fill="${c}"/>
    <path d="M 30,20 C 30,8 42,4 50,10 C 58,4 70,8 70,20" fill="none" stroke="${handle}" stroke-width="6"/>
    <circle cx="50" cy="14" r="5" fill="${handle}"/>`;
}
function renderElCuttingBoard(p) {
  const board = p.color || '#d9a441';
  const knife = p.color2 || '#8a8f9c';
  return `<rect x="6" y="10" width="88" height="70" rx="8" fill="${board}"/>
    <circle cx="86" cy="20" r="5" fill="none" stroke="#a4703a" stroke-width="2"/>
    <g transform="rotate(30 50 50)">
      <rect x="30" y="46" width="40" height="8" fill="${knife}"/>
      <polygon points="70,46 90,50 70,54" fill="${knife}"/>
      <rect x="22" y="44" width="10" height="12" rx="2" fill="#4a2c1e"/>
    </g>`;
}
function renderElRollingPin(p) {
  const c = p.color || '#d9a441';
  const handle = p.color2 || '#f2d9b8';
  return `<g transform="rotate(-15 50 50)">
    <rect x="24" y="30" width="52" height="40" rx="6" fill="${c}"/>
    <rect x="4" y="38" width="20" height="24" rx="10" fill="${handle}"/>
    <rect x="76" y="38" width="20" height="24" rx="10" fill="${handle}"/>
  </g>`;
}
function renderElBlender(p) {
  const c = p.color || '#4a5568';
  const glass = p.color2 || '#bfe3f5';
  return `<rect x="34" y="4" width="32" height="14" rx="3" fill="${c}"/>
    <path d="M 30,18 L 70,18 L 66,60 L 34,60 Z" fill="${glass}" stroke="${c}" stroke-width="3"/>
    <rect x="26" y="60" width="48" height="34" rx="5" fill="${c}"/>
    <circle cx="40" cy="78" r="5" fill="#e04f4f"/>
    <circle cx="60" cy="78" r="5" fill="#22c55e"/>`;
}
function renderElToaster(p) {
  const c = p.color || '#c7d0dc';
  const c2 = p.color2 || '#4a5568';
  return `<rect x="8" y="34" width="84" height="52" rx="6" fill="${c}"/>
    <rect x="20" y="26" width="24" height="10" rx="3" fill="${c2}"/>
    <rect x="56" y="26" width="24" height="10" rx="3" fill="${c2}"/>
    <rect x="14" y="46" width="16" height="12" rx="2" fill="${c2}"/>
    <circle cx="76" cy="60" r="4" fill="#e04f4f"/>
    <rect x="40" y="62" width="20" height="8" rx="3" fill="${c2}"/>`;
}
function renderElMicrowave(p) {
  const c = p.color || '#4a5568';
  const win = p.color2 || '#2b2b40';
  return `<rect x="6" y="20" width="88" height="62" rx="6" fill="${c}"/>
    <rect x="12" y="28" width="58" height="46" fill="${win}"/>
    <rect x="14" y="30" width="54" height="42" fill="${win}" opacity="0.7"/>
    <circle cx="80" cy="40" r="6" fill="#8a8f9c"/>
    <rect x="74" y="54" width="12" height="3" fill="#8a8f9c"/>
    <rect x="74" y="62" width="12" height="3" fill="#8a8f9c"/>`;
}
function renderElRefrigerator(p) {
  const c = p.color || '#c7d0dc';
  const c2 = p.color2 || '#8a8f9c';
  return `<rect x="20" y="6" width="60" height="88" rx="6" fill="${c}"/>
    <line x1="20" y1="36" x2="80" y2="36" stroke="${c2}" stroke-width="3"/>
    <rect x="26" y="20" width="4" height="10" rx="2" fill="${c2}"/>
    <rect x="26" y="44" width="4" height="20" rx="2" fill="${c2}"/>`;
}
function renderElOven(p) {
  const c = p.color || '#4a5568';
  const win = p.color2 || '#2b2b40';
  return `<rect x="8" y="14" width="84" height="80" rx="6" fill="${c}"/>
    <rect x="14" y="20" width="72" height="14" rx="2" fill="${win}"/>
    <rect x="14" y="40" width="72" height="46" rx="4" fill="${win}"/>
    <circle cx="20" cy="26" r="3" fill="#e04f4f"/>
    <circle cx="30" cy="26" r="3" fill="#22c55e"/>
    <circle cx="80" cy="26" r="3" fill="#f2b632"/>
    <rect x="22" y="52" width="56" height="24" rx="3" fill="#c7d0dc" opacity="0.25"/>`;
}
function renderElSink(p) {
  const c = p.color || '#c7d0dc';
  const c2 = p.color2 || '#8a8f9c';
  return `<path d="M 10,36 L 90,36 L 86,74 C 84,82 76,86 66,86 L 34,86 C 24,86 16,82 14,74 Z" fill="${c}" stroke="${c2}" stroke-width="3"/>
    <path d="M 40,10 L 40,30 L 44,36 L 56,36 L 60,30 L 60,10" fill="none" stroke="${c2}" stroke-width="5" stroke-linecap="round"/>
    <line x1="50" y1="10" x2="56" y2="4" stroke="${c2}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="50" cy="90" r="2.5" fill="${c2}"/>`;
}

/* ---------- security ---------- */
function renderElPadlock(p) {
  const body = p.color || '#f2b632';
  const shackle = p.color2 || '#8a8f9c';
  return `<path d="M 30,44 L 30,30 C 30,14 40,4 50,4 C 60,4 70,14 70,30 L 70,44" fill="none" stroke="${shackle}" stroke-width="8"/>
    <rect x="18" y="44" width="64" height="50" rx="8" fill="${body}"/>
    <circle cx="50" cy="64" r="8" fill="#4a4a4a"/>
    <rect x="46" y="68" width="8" height="14" fill="#4a4a4a"/>`;
}
function renderElShieldIcon(p) {
  const c = p.color || '#4f7df3';
  const mark = p.color2 || '#ffffff';
  return `<path d="M 50,4 L 88,18 L 88,46 C 88,72 70,90 50,98 C 30,90 12,72 12,46 L 12,18 Z" fill="${c}"/>
    <path d="M 32,50 L 44,64 L 70,32" fill="none" stroke="${mark}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function renderElFingerprint(p) {
  const c = p.color || '#4a5568';
  return `<path d="M 50,90 C 26,90 14,70 14,50 C 14,28 30,10 50,10 C 70,10 86,28 86,50" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <path d="M 50,78 C 32,78 24,64 24,50 C 24,34 36,22 50,22 C 64,22 76,34 76,50" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <path d="M 50,66 C 40,66 34,58 34,50 C 34,40 42,34 50,34 C 58,34 64,40 64,48" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="50" y1="50" x2="50" y2="58" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
}
function renderElCctvCamera(p) {
  const c = p.color || '#2b2b40';
  const lens = p.color2 || '#4f9de0';
  return `<rect x="4" y="10" width="18" height="18" rx="3" fill="${c}"/>
    <path d="M 18,16 L 78,30 C 90,33 92,50 80,54 L 18,46 Z" fill="${c}"/>
    <circle cx="78" cy="40" r="10" fill="${lens}"/>
    <circle cx="78" cy="40" r="5" fill="#0a0a12"/>
    <rect x="14" y="46" width="8" height="20" fill="${c}"/>`;
}
function renderElKeyCard(p) {
  const c = p.color || '#4f7df3';
  const chip = p.color2 || '#f2b632';
  return `<rect x="6" y="20" width="88" height="60" rx="8" fill="${c}"/>
    <rect x="16" y="34" width="18" height="14" rx="3" fill="${chip}"/>
    <line x1="16" y1="60" x2="70" y2="60" stroke="#ffffff" stroke-width="3" opacity="0.7"/>
    <line x1="16" y1="68" x2="50" y2="68" stroke="#ffffff" stroke-width="3" opacity="0.7"/>`;
}
function renderElAlarmBell(p) {
  const c = p.color || '#e04f4f';
  const base = p.color2 || '#4a5568';
  return `<path d="M 50,10 C 34,10 28,24 28,36 L 28,58 L 14,74 L 86,74 L 72,58 L 72,36 C 72,24 66,10 50,10 Z" fill="${c}"/>
    <rect x="42" y="74" width="16" height="6" fill="${base}"/>
    <path d="M 40,80 C 40,88 44,94 50,94 C 56,94 60,88 60,80" fill="none" stroke="${base}" stroke-width="4"/>
    <path d="M 22,30 L 12,24 M 78,30 L 88,24 M 50,4 L 50,0" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
}
function renderElSafeBox(p) {
  const c = p.color || '#4a5568';
  const dial = p.color2 || '#f2b632';
  return `<rect x="10" y="14" width="80" height="76" rx="6" fill="${c}"/>
    <rect x="16" y="20" width="68" height="64" fill="${c}" stroke="#2b2b40" stroke-width="2"/>
    <circle cx="50" cy="50" r="18" fill="none" stroke="${dial}" stroke-width="4"/>
    <circle cx="50" cy="50" r="6" fill="${dial}"/>
    <line x1="50" y1="32" x2="50" y2="68" stroke="${dial}" stroke-width="3"/>
    <line x1="32" y1="50" x2="68" y2="50" stroke="${dial}" stroke-width="3"/>
    <rect x="80" y="44" width="6" height="12" rx="2" fill="${dial}"/>`;
}
function renderElDoorLock(p) {
  const c = p.color || '#f2b632';
  const c2 = p.color2 || '#4a5568';
  return `<rect x="30" y="6" width="40" height="52" rx="6" fill="${c}"/>
    <circle cx="50" cy="32" r="10" fill="${c2}"/>
    <rect x="46" y="36" width="8" height="14" fill="${c2}"/>
    <rect x="20" y="58" width="60" height="36" rx="4" fill="${c2}"/>
    <line x1="30" y1="70" x2="70" y2="70" stroke="${c}" stroke-width="3"/>
    <line x1="30" y1="80" x2="60" y2="80" stroke="${c}" stroke-width="3"/>`;
}
function renderElSecurityGate(p) {
  const c = p.color || '#c7d0dc';
  const c2 = p.color2 || '#e04f4f';
  return `<rect x="8" y="16" width="84" height="8" rx="3" fill="${c2}"/>
    ${[0,1,2,3,4].map(i => `<line x1="${16 + i * 17}" y1="24" x2="${16 + i * 17}" y2="78" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`).join('')}
    <rect x="8" y="78" width="84" height="8" rx="3" fill="${c2}"/>
    <circle cx="50" cy="90" r="6" fill="${c}"/>`;
}
function renderElWarningSign(p) {
  const c = p.color || '#f2b632';
  const mark = p.color2 || '#2b2b40';
  return `<polygon points="50,6 94,90 6,90" fill="${c}" stroke="${mark}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="46" y="34" width="8" height="30" rx="3" fill="${mark}"/>
    <circle cx="50" cy="76" r="5" fill="${mark}"/>`;
}

/* ---------- time_calendar ---------- */
function renderElCalendarPage(p) {
  const c = p.color || '#e04f4f';
  const page = p.color2 || '#ffffff';
  return `<rect x="10" y="18" width="80" height="74" rx="6" fill="${page}" stroke="${c}" stroke-width="4"/>
    <rect x="10" y="18" width="80" height="20" fill="${c}"/>
    <rect x="26" y="6" width="8" height="18" rx="3" fill="${c}"/>
    <rect x="66" y="6" width="8" height="18" rx="3" fill="${c}"/>
    ${[0, 1, 2].map(row => [0, 1, 2, 3].map(col =>
      `<rect x="${20 + col * 16}" y="${46 + row * 16}" width="10" height="10" rx="2" fill="${c}" opacity="${row === 1 && col === 2 ? 1 : 0.3}"/>`
    ).join('')).join('')}`;
}
function renderElHourglass(p) {
  const frame = p.color || '#d9a441';
  const sand = p.color2 || '#f2d9b8';
  return `<path d="M 20,6 L 80,6 L 80,14 L 54,50 L 80,86 L 80,94 L 20,94 L 20,86 L 46,50 L 20,14 Z" fill="none" stroke="${frame}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M 28,14 L 72,14 L 50,44 Z" fill="${sand}"/>
    <path d="M 50,56 L 30,86 L 70,86 Z" fill="${sand}"/>`;
}
function renderElStopwatch(p) {
  const c = p.color || '#3f6fb0';
  const face = p.color2 || '#ffffff';
  return `<rect x="42" y="2" width="16" height="10" rx="3" fill="${c}"/>
    <line x1="66" y1="10" x2="74" y2="18" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="50" cy="56" r="38" fill="${face}" stroke="${c}" stroke-width="7"/>
    <line x1="50" y1="56" x2="50" y2="30" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="50" y1="56" x2="66" y2="62" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
}
function renderElAlarmClock(p) {
  const c = p.color || '#e04f4f';
  const face = p.color2 || '#ffffff';
  return `<circle cx="24" cy="18" r="10" fill="${c}"/>
    <circle cx="76" cy="18" r="10" fill="${c}"/>
    <line x1="24" y1="18" x2="34" y2="30" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="76" y1="18" x2="66" y2="30" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="50" cy="58" r="36" fill="${face}" stroke="${c}" stroke-width="7"/>
    <line x1="50" y1="58" x2="50" y2="36" stroke="#2b2b40" stroke-width="4" stroke-linecap="round"/>
    <line x1="50" y1="58" x2="64" y2="64" stroke="#2b2b40" stroke-width="4" stroke-linecap="round"/>
    <rect x="30" y="92" width="10" height="8" rx="2" fill="${c}"/>
    <rect x="60" y="92" width="10" height="8" rx="2" fill="${c}"/>`;
}
function renderElWallClock(p) {
  const c = p.color || '#6d4a2f';
  const face = p.color2 || '#f2d9b8';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <circle cx="50" cy="50" r="36" fill="${face}"/>
    ${[0,1,2,3].map(i => {
      const a = (i / 4) * Math.PI * 2;
      return `<circle cx="${(50 + Math.cos(a) * 30).toFixed(1)}" cy="${(50 + Math.sin(a) * 30).toFixed(1)}" r="2" fill="${c}"/>`;
    }).join('')}
    <line x1="50" y1="50" x2="50" y2="30" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="50" y1="50" x2="62" y2="56" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="3.5" fill="${c}"/>`;
}
function renderElDigitalClock(p) {
  const c = p.color || '#2b2b40';
  const led = p.color2 || '#22c55e';
  return `<rect x="6" y="26" width="88" height="48" rx="6" fill="${c}"/>
    <text x="50" y="60" font-size="28" font-family="Courier New, monospace" text-anchor="middle" fill="${led}" font-weight="bold">10:30</text>
    <rect x="6" y="80" width="88" height="6" rx="2" fill="${c}" opacity="0.7"/>
    <circle cx="20" cy="44" r="2.5" fill="${led}" opacity="0.7"/>
    <circle cx="80" cy="44" r="2.5" fill="#e04f4f" opacity="0.7"/>`;
}
function renderElSandTimer(p) {
  const c = p.color || '#d9a441';
  const sand = p.color2 || '#f2b632';
  return `<path d="M 24,10 L 76,10 L 76,18 L 54,50 L 76,82 L 76,90 L 24,90 L 24,82 L 46,50 L 24,18 Z" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M 34,18 L 66,18 L 50,42 Z" fill="${sand}"/>
    <path d="M 50,60 L 40,82 L 60,82 Z" fill="${sand}"/>`;
}
function renderElClockTower(p) {
  const c = p.color || '#b3432f';
  const face = p.color2 || '#f2d9b8';
  return `<polygon points="50,4 80,26 20,26" fill="${c}"/>
    <rect x="24" y="26" width="52" height="68" fill="${c}"/>
    <circle cx="50" cy="48" r="16" fill="${face}"/>
    <line x1="50" y1="48" x2="50" y2="36" stroke="${c}" stroke-width="3"/>
    <line x1="50" y1="48" x2="60" y2="52" stroke="${c}" stroke-width="2.5"/>
    <rect x="38" y="72" width="24" height="22" fill="${face}" opacity="0.85"/>`;
}

/* ---------- buildings_infra ---------- */
function renderElBridge(p) {
  const c = p.color || '#4a5568';
  const cable = p.color2 || '#c7d0dc';
  return `<path d="M 6,58 C 6,28 94,28 94,58" fill="none" stroke="${c}" stroke-width="6"/>
    <line x1="50" y1="14" x2="50" y2="58" stroke="${c}" stroke-width="6"/>
    ${[16, 28, 40, 60, 72, 84].map(x => `<line x1="${x}" y1="${x < 50 ? 58 - (x - 6) * 0.9 : 58 - (94 - x) * 0.9}" x2="${x}" y2="72" stroke="${cable}" stroke-width="2"/>`).join('')}
    <rect x="0" y="72" width="100" height="10" fill="${c}"/>
    <rect x="8" y="82" width="10" height="14" fill="${c}"/>
    <rect x="82" y="82" width="10" height="14" fill="${c}"/>`;
}
function renderElFactory(p) {
  const c = p.color || '#7d8ba1';
  const smoke = p.color2 || '#c7d0dc';
  return `<rect x="10" y="50" width="80" height="46" fill="${c}"/>
    <polygon points="10,50 34,30 34,50" fill="${c}"/>
    <polygon points="34,50 58,30 58,50" fill="${c}"/>
    <polygon points="58,50 82,30 82,50" fill="${c}"/>
    <rect x="66" y="10" width="12" height="24" fill="${c}"/>
    <circle cx="72" cy="6" r="7" fill="${smoke}" opacity="0.8"/>
    <circle cx="80" cy="0" r="6" fill="${smoke}" opacity="0.6"/>
    <rect x="22" y="64" width="14" height="14" fill="#eef3ea"/>
    <rect x="44" y="64" width="14" height="14" fill="#eef3ea"/>
    <rect x="66" y="64" width="14" height="26" fill="#4a2c1e"/>`;
}
function renderElSkyscraper(p) {
  const c = p.color || '#4f7df3';
  const window_ = p.color2 || '#bfe3f5';
  let windows = '';
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 3; col++) {
      windows += `<rect x="${28 + col * 16}" y="${10 + row * 14}" width="10" height="8" fill="${window_}" opacity="0.85"/>`;
    }
  }
  return `<rect x="20" y="4" width="60" height="92" rx="2" fill="${c}"/>${windows}`;
}
function renderElCrane(p) {
  const c = p.color || '#f2b632';
  const hook = p.color2 || '#4a4a4a';
  return `<rect x="20" y="40" width="10" height="56" fill="${c}"/>
    <line x1="25" y1="40" x2="90" y2="30" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <line x1="25" y1="40" x2="10" y2="52" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <line x1="25" y1="16" x2="25" y2="40" stroke="${c}" stroke-width="7"/>
    <line x1="25" y1="16" x2="80" y2="30" stroke="${c}" stroke-width="3"/>
    <line x1="80" y1="30" x2="80" y2="56" stroke="${hook}" stroke-width="2"/>
    <rect x="76" y="56" width="8" height="10" fill="${hook}"/>
    <rect x="6" y="92" width="28" height="4" fill="#2b2b40"/>`;
}
function renderElTrafficLight(p) {
  const box = p.color || '#2b2b40';
  const pole = p.color2 || '#4a5568';
  return `<rect x="42" y="40" width="16" height="52" fill="${pole}"/>
    <rect x="30" y="4" width="40" height="80" rx="8" fill="${box}"/>
    <circle cx="50" cy="20" r="10" fill="#e04f4f"/>
    <circle cx="50" cy="44" r="10" fill="#f2b632" opacity="0.5"/>
    <circle cx="50" cy="68" r="10" fill="#22c55e" opacity="0.5"/>`;
}
function renderElStreetLamp(p) {
  const c = p.color || '#4a5568';
  const glow = p.color2 || '#f5c518';
  return `<rect x="46" y="30" width="8" height="66" fill="${c}"/>
    <path d="M 50,30 C 50,14 70,10 76,20" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="78" cy="24" r="12" fill="${glow}"/>
    <rect x="30" y="92" width="40" height="6" rx="2" fill="${c}"/>`;
}
function renderElWindmill(p) {
  const c = p.color || '#c7d0dc';
  const blade = p.color2 || '#4a5568';
  return `<polygon points="42,40 58,40 62,94 38,94" fill="${c}"/>
    <circle cx="50" cy="40" r="4" fill="${blade}"/>
    <rect x="48" y="6" width="4" height="34" fill="${blade}"/>
    <rect x="48" y="40" width="34" height="4" fill="${blade}"/>
    <rect x="48" y="40" width="4" height="34" fill="${blade}"/>
    <rect x="14" y="40" width="34" height="4" fill="${blade}"/>`;
}
function renderElWaterTower(p) {
  const c = p.color || '#8a8f9c';
  const c2 = p.color2 || '#4a5568';
  return `<path d="M 24,26 L 76,26 L 66,52 L 34,52 Z" fill="${c}"/>
    <ellipse cx="50" cy="26" rx="26" ry="6" fill="${c2}"/>
    <line x1="38" y1="52" x2="30" y2="94" stroke="${c2}" stroke-width="5"/>
    <line x1="62" y1="52" x2="70" y2="94" stroke="${c2}" stroke-width="5"/>
    <line x1="46" y1="52" x2="42" y2="94" stroke="${c2}" stroke-width="3"/>
    <line x1="54" y1="52" x2="58" y2="94" stroke="${c2}" stroke-width="3"/>`;
}
function renderElSolarPanel(p) {
  const c = p.color || '#4f7df3';
  const grid = p.color2 || '#1a3e73';
  return `<g transform="rotate(-15 50 50)">
    <rect x="6" y="20" width="88" height="52" rx="3" fill="${c}"/>
    ${[1,2,3,4].map(i => `<line x1="${6 + i * 17.6}" y1="20" x2="${6 + i * 17.6}" y2="72" stroke="${grid}" stroke-width="2"/>`).join('')}
    ${[1,2].map(i => `<line x1="6" y1="${20 + i * 17.3}" x2="94" y2="${20 + i * 17.3}" stroke="${grid}" stroke-width="2"/>`).join('')}
  </g>
    <rect x="46" y="74" width="8" height="20" fill="#8a8f9c"/>`;
}
function renderElDam(p) {
  const c = p.color || '#8a8f9c';
  const water = p.color2 || '#4f9de0';
  return `<path d="M 20,26 L 80,50 L 80,94 L 20,94 Z" fill="${c}"/>
    <path d="M 20,26 L 80,50 L 80,94 L 20,94 Z" fill="none" stroke="#4a5568" stroke-width="2"/>
    <path d="M 0,40 C 20,44 40,56 60,72 L 80,88 L 80,94 L 0,94 Z" fill="${water}" opacity="0.8"/>
    <line x1="30" y1="40" x2="30" y2="88" stroke="#4a5568" stroke-width="2" opacity="0.5"/>
    <line x1="50" y1="52" x2="50" y2="92" stroke="#4a5568" stroke-width="2" opacity="0.5"/>
    <line x1="70" y1="64" x2="70" y2="94" stroke="#4a5568" stroke-width="2" opacity="0.5"/>`;
}
function renderElLighthouse(p) {
  const c = p.color || '#e04f4f';
  const c2 = p.color2 || '#ffffff';
  return `<path d="M 34,26 L 66,26 L 74,94 L 26,94 Z" fill="${c}"/>
    <line x1="33" y1="44" x2="67" y2="44" stroke="${c2}" stroke-width="6"/>
    <line x1="29" y1="64" x2="71" y2="64" stroke="${c2}" stroke-width="6"/>
    <rect x="30" y="14" width="40" height="12" rx="2" fill="#4a5568"/>
    <rect x="36" y="6" width="28" height="10" fill="${c2}"/>
    <polygon points="50,0 60,6 40,6" fill="${c}"/>`;
}
function renderElRadioTower(p) {
  const c = p.color || '#e04f4f';
  const c2 = p.color2 || '#4a5568';
  return `<polygon points="42,94 58,94 54,20 46,20" fill="${c}"/>
    <line x1="46" y1="40" x2="54" y2="40" stroke="${c2}" stroke-width="3"/>
    <line x1="44" y1="60" x2="56" y2="60" stroke="${c2}" stroke-width="3"/>
    <line x1="43" y1="78" x2="57" y2="78" stroke="${c2}" stroke-width="3"/>
    <circle cx="50" cy="14" r="4" fill="${c2}"/>
    <path d="M 34,10 A 20,20 0 0 1 66,10" fill="none" stroke="${c}" stroke-width="3"/>
    <path d="M 26,2 A 30,30 0 0 1 74,2" fill="none" stroke="${c}" stroke-width="3"/>`;
}

/* ---------- vehicles ---------- */
function renderElCar(p) {
  const body = p.color || '#e04f4f';
  const window_ = p.color2 || '#bfe3f5';
  return `<path d="M 6,66 L 12,44 C 16,36 26,32 36,32 L 64,32 C 74,32 84,36 88,44 L 94,66 Z" fill="${body}"/>
    <path d="M 28,34 L 36,16 L 64,16 L 72,34 Z" fill="${body}"/>
    <path d="M 32,32 L 38,20 L 62,20 L 68,32 Z" fill="${window_}"/>
    <rect x="4" y="66" width="92" height="12" rx="4" fill="${body}"/>
    <circle cx="26" cy="80" r="12" fill="#2b2b40"/>
    <circle cx="74" cy="80" r="12" fill="#2b2b40"/>
    <circle cx="26" cy="80" r="5" fill="#8a8f9c"/>
    <circle cx="74" cy="80" r="5" fill="#8a8f9c"/>`;
}
function renderElBicycle(p) {
  const c = p.color || '#2b2b40';
  const wheel = p.color2 || '#8a8f9c';
  return `<circle cx="24" cy="72" r="22" fill="none" stroke="${wheel}" stroke-width="5"/>
    <circle cx="76" cy="72" r="22" fill="none" stroke="${wheel}" stroke-width="5"/>
    <path d="M 24,72 L 46,34 L 66,34 M 46,34 L 76,72 M 24,72 L 58,72 L 76,72" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M 46,34 L 40,22 L 54,22" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <path d="M 58,72 L 66,34" fill="none" stroke="${c}" stroke-width="5"/>`;
}
function renderElBus(p) {
  const body = p.color || '#f2b632';
  const window_ = p.color2 || '#bfe3f5';
  return `<rect x="6" y="16" width="88" height="56" rx="8" fill="${body}"/>
    <rect x="14" y="24" width="18" height="16" fill="${window_}"/>
    <rect x="38" y="24" width="18" height="16" fill="${window_}"/>
    <rect x="62" y="24" width="18" height="16" fill="${window_}"/>
    <rect x="14" y="48" width="66" height="4" fill="#ffffff" opacity="0.6"/>
    <rect x="4" y="72" width="92" height="8" fill="${body}"/>
    <circle cx="26" cy="84" r="10" fill="#2b2b40"/>
    <circle cx="74" cy="84" r="10" fill="#2b2b40"/>`;
}
function renderElMotorcycle(p) {
  const c = p.color || '#4a5568';
  const wheel = p.color2 || '#2b2b40';
  return `<circle cx="20" cy="76" r="16" fill="none" stroke="${wheel}" stroke-width="5"/>
    <circle cx="80" cy="76" r="16" fill="none" stroke="${wheel}" stroke-width="5"/>
    <path d="M 20,76 L 42,60 L 58,60 L 80,76" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M 42,60 L 50,36 L 66,36" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <rect x="46" y="46" width="24" height="10" rx="4" fill="${c}"/>`;
}
function renderElTrain(p) {
  const c = p.color || '#4a5568';
  const window_ = p.color2 || '#bfe3f5';
  return `<rect x="10" y="30" width="80" height="42" rx="8" fill="${c}"/>
    <rect x="20" y="10" width="20" height="20" fill="${c}"/>
    <rect x="22" y="40" width="16" height="16" fill="${window_}"/>
    <rect x="46" y="40" width="16" height="16" fill="${window_}"/>
    <rect x="70" y="40" width="12" height="16" fill="${window_}"/>
    <circle cx="26" cy="80" r="9" fill="#2b2b40"/>
    <circle cx="50" cy="80" r="9" fill="#2b2b40"/>
    <circle cx="74" cy="80" r="9" fill="#2b2b40"/>`;
}
function renderElBoat(p) {
  const hull = p.color2 || '#4a5568';
  const sail = p.color || '#4f7df3';
  return `<path d="M 10,66 L 90,66 L 78,86 L 22,86 Z" fill="${hull}"/>
    <line x1="50" y1="10" x2="50" y2="66" stroke="#4a2c1e" stroke-width="4"/>
    <path d="M 50,14 L 80,60 L 50,60 Z" fill="${sail}"/>
    <path d="M 50,26 L 30,60 L 50,60 Z" fill="${sail}" opacity="0.8"/>`;
}
function renderElDeliveryVan(p) {
  const c = p.color || '#f2b632';
  const window_ = p.color2 || '#bfe3f5';
  return `<rect x="6" y="30" width="60" height="40" rx="4" fill="${c}"/>
    <path d="M 66,42 L 88,42 C 92,42 94,46 94,50 L 94,70 L 66,70 Z" fill="${c}"/>
    <rect x="72" y="48" width="16" height="14" fill="${window_}"/>
    <rect x="14" y="38" width="20" height="16" fill="${window_}"/>
    <circle cx="28" cy="82" r="10" fill="#2b2b40"/>
    <circle cx="78" cy="82" r="10" fill="#2b2b40"/>`;
}
function renderElHelicopter(p) {
  const c = p.color || '#4f7df3';
  const glass = p.color2 || '#bfe3f5';
  return `<line x1="6" y1="18" x2="94" y2="18" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <line x1="50" y1="18" x2="50" y2="34" stroke="${c}" stroke-width="3"/>
    <ellipse cx="46" cy="56" rx="34" ry="22" fill="${c}"/>
    <circle cx="30" cy="56" r="12" fill="${glass}"/>
    <path d="M 76,56 L 96,68 L 94,74 L 72,68 Z" fill="${c}"/>
    <line x1="26" y1="78" x2="26" y2="94" stroke="${c}" stroke-width="4"/>
    <line x1="66" y1="78" x2="66" y2="94" stroke="${c}" stroke-width="4"/>
    <line x1="14" y1="94" x2="78" y2="94" stroke="${c}" stroke-width="4"/>`;
}
function renderElSubmarine(p) {
  const c = p.color || '#4a5568';
  const c2 = p.color2 || '#8a8f9c';
  return `<ellipse cx="50" cy="56" rx="42" ry="20" fill="${c}"/>
    <rect x="42" y="20" width="16" height="24" rx="4" fill="${c2}"/>
    <rect x="46" y="30" width="8" height="14" fill="#bfe3f5"/>
    <line x1="10" y1="56" x2="4" y2="46" stroke="${c}" stroke-width="3"/>
    <line x1="10" y1="56" x2="4" y2="66" stroke="${c}" stroke-width="3"/>
    <circle cx="30" cy="56" r="4" fill="#bfe3f5"/>
    <circle cx="42" cy="56" r="4" fill="#bfe3f5"/>
    <circle cx="54" cy="56" r="4" fill="#bfe3f5"/>`;
}
function renderElScooter(p) {
  const c = p.color || '#22c55e';
  const wheel = p.color2 || '#2b2b40';
  return `<circle cx="24" cy="80" r="12" fill="none" stroke="${wheel}" stroke-width="5"/>
    <circle cx="78" cy="80" r="12" fill="none" stroke="${wheel}" stroke-width="5"/>
    <path d="M 24,80 L 44,60 L 62,60 L 78,80" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 62,60 L 70,26 L 82,26" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <rect x="30" y="52" width="28" height="10" rx="3" fill="${c}"/>`;
}
function renderElTruck(p) {
  const c = p.color || '#4f7df3';
  const win = p.color2 || '#bfe3f5';
  return `<rect x="4" y="26" width="56" height="46" fill="${c}"/>
    <path d="M 60,38 L 88,38 C 94,38 96,44 96,50 L 96,72 L 60,72 Z" fill="${c}"/>
    <rect x="66" y="46" width="22" height="14" fill="${win}"/>
    <circle cx="20" cy="80" r="10" fill="#2b2b40"/>
    <circle cx="44" cy="80" r="10" fill="#2b2b40"/>
    <circle cx="78" cy="80" r="10" fill="#2b2b40"/>`;
}
function renderElFerry(p) {
  const c = p.color || '#4a5568';
  const c2 = p.color2 || '#f2b632';
  return `<path d="M 6,60 L 94,60 L 84,84 L 16,84 Z" fill="${c}"/>
    <rect x="26" y="30" width="48" height="30" fill="${c}"/>
    <rect x="34" y="38" width="10" height="12" fill="#bfe3f5"/>
    <rect x="48" y="38" width="10" height="12" fill="#bfe3f5"/>
    <rect x="62" y="38" width="10" height="12" fill="#bfe3f5"/>
    <rect x="44" y="14" width="12" height="20" fill="${c2}"/>
    <line x1="50" y1="6" x2="50" y2="20" stroke="${c2}" stroke-width="3"/>`;
}
function renderElAmbulance(p) {
  const c = p.color || '#ffffff';
  const stripe = p.color2 || '#e04f4f';
  return `<rect x="6" y="30" width="60" height="40" fill="${c}" stroke="#c7d0dc" stroke-width="2"/>
    <path d="M 66,42 L 92,42 C 94,42 96,46 96,50 L 96,70 L 66,70 Z" fill="${c}" stroke="#c7d0dc" stroke-width="2"/>
    <rect x="72" y="48" width="18" height="14" fill="#bfe3f5"/>
    <rect x="6" y="52" width="60" height="8" fill="${stripe}"/>
    <circle cx="28" cy="82" r="10" fill="#2b2b40"/>
    <circle cx="78" cy="82" r="10" fill="#2b2b40"/>
    <rect x="42" y="18" width="10" height="14" fill="${stripe}"/>
    <rect x="38" y="22" width="18" height="6" fill="${stripe}"/>`;
}
function renderElFireTruck(p) {
  const c = p.color || '#e04f4f';
  const win = p.color2 || '#bfe3f5';
  return `<rect x="6" y="26" width="76" height="48" fill="${c}"/>
    <path d="M 82,40 L 96,40 C 98,40 100,44 100,48 L 100,74 L 82,74 Z" fill="${c}"/>
    <rect x="86" y="48" width="10" height="12" fill="${win}"/>
    <rect x="14" y="34" width="18" height="14" fill="${win}"/>
    <line x1="6" y1="58" x2="96" y2="58" stroke="#ffffff" stroke-width="3"/>
    <circle cx="26" cy="82" r="10" fill="#2b2b40"/>
    <circle cx="60" cy="82" r="10" fill="#2b2b40"/>
    <circle cx="88" cy="82" r="10" fill="#2b2b40"/>
    <rect x="34" y="14" width="24" height="12" rx="3" fill="#f2b632"/>`;
}

/* ---------- office ---------- */
function renderElBriefcase(p) {
  const c = p.color || '#6d4a2f';
  const trim = p.color2 || '#f2b632';
  return `<rect x="8" y="34" width="84" height="54" rx="8" fill="${c}"/>
    <rect x="36" y="18" width="28" height="18" rx="4" fill="none" stroke="${c}" stroke-width="6"/>
    <rect x="8" y="52" width="84" height="10" fill="${trim}"/>
    <rect x="44" y="54" width="12" height="10" rx="2" fill="${trim}"/>`;
}
function renderElIdBadge(p) {
  const c = p.color || '#4f7df3';
  const photo = p.color2 || '#c7d0dc';
  return `<rect x="42" y="2" width="16" height="10" rx="3" fill="#8a8f9c"/>
    <rect x="20" y="10" width="60" height="84" rx="8" fill="#ffffff" stroke="${c}" stroke-width="4"/>
    <rect x="32" y="22" width="36" height="30" rx="4" fill="${photo}"/>
    <circle cx="50" cy="32" r="8" fill="#ffffff"/>
    <path d="M 36,48 C 36,38 64,38 64,48" fill="#ffffff"/>
    <line x1="32" y1="62" x2="68" y2="62" stroke="${c}" stroke-width="3"/>
    <line x1="32" y1="72" x2="68" y2="72" stroke="${c}" stroke-width="3"/>`;
}
function renderElFolderStack(p) {
  const back = p.color2 || '#d9a441';
  const front = p.color || '#f2b632';
  return `<path d="M 12,30 L 40,30 L 46,38 L 90,38 L 90,80 L 12,80 Z" fill="${back}"/>
    <path d="M 6,40 L 34,40 L 40,48 L 84,48 L 84,88 L 6,88 Z" fill="${front}"/>`;
}
function renderElPresentationScreen(p) {
  const c = p.color || '#4a5568';
  const chart = p.color2 || '#4f7df3';
  return `<rect x="8" y="6" width="84" height="58" rx="4" fill="#ffffff" stroke="${c}" stroke-width="4"/>
    <rect x="20" y="40" width="10" height="16" fill="${chart}"/>
    <rect x="36" y="30" width="10" height="26" fill="${chart}"/>
    <rect x="52" y="20" width="10" height="36" fill="${chart}"/>
    <rect x="68" y="34" width="10" height="22" fill="${chart}"/>
    <rect x="44" y="64" width="12" height="20" fill="${c}"/>
    <rect x="24" y="84" width="52" height="8" rx="3" fill="${c}"/>`;
}
function renderElClipboard(p) {
  const board = p.color || '#8a8f9c';
  const clip = p.color2 || '#c7d0dc';
  return `<rect x="14" y="14" width="72" height="82" rx="6" fill="${board}"/>
    <rect x="26" y="26" width="48" height="58" fill="#ffffff"/>
    <rect x="38" y="4" width="24" height="18" rx="4" fill="${clip}"/>
    <line x1="32" y1="40" x2="68" y2="40" stroke="${board}" stroke-width="3"/>
    <line x1="32" y1="52" x2="68" y2="52" stroke="${board}" stroke-width="3"/>
    <line x1="32" y1="64" x2="56" y2="64" stroke="${board}" stroke-width="3"/>`;
}
function renderElStickyNote(p) {
  const c = p.color || '#f5d76e';
  return `<path d="M 10,10 L 90,10 L 90,74 L 74,90 L 10,90 Z" fill="${c}"/>
    <path d="M 90,74 L 74,74 L 74,90 Z" fill="#c9ab4a"/>
    <line x1="22" y1="30" x2="68" y2="30" stroke="#c9ab4a" stroke-width="3" opacity="0.6"/>
    <line x1="22" y1="42" x2="68" y2="42" stroke="#c9ab4a" stroke-width="3" opacity="0.6"/>
    <line x1="22" y1="54" x2="54" y2="54" stroke="#c9ab4a" stroke-width="3" opacity="0.6"/>`;
}
function renderElDeskLamp(p) {
  const c = p.color || '#4a5568';
  const glow = p.color2 || '#f5c518';
  return `<rect x="16" y="90" width="40" height="6" rx="2" fill="${c}"/>
    <line x1="36" y1="90" x2="36" y2="64" stroke="${c}" stroke-width="5"/>
    <line x1="36" y1="64" x2="74" y2="46" stroke="${c}" stroke-width="5"/>
    <line x1="74" y1="46" x2="74" y2="26" stroke="${c}" stroke-width="5"/>
    <path d="M 60,26 L 88,26 L 82,44 L 66,44 Z" fill="${c}"/>
    <ellipse cx="74" cy="50" rx="16" ry="6" fill="${glow}" opacity="0.6"/>`;
}
function renderElDeskChair(p) {
  const c = p.color || '#2b2b40';
  const c2 = p.color2 || '#4a5568';
  return `<path d="M 26,10 L 74,10 L 70,48 L 30,48 Z" fill="${c}"/>
    <rect x="24" y="48" width="52" height="12" rx="4" fill="${c2}"/>
    <line x1="50" y1="60" x2="50" y2="80" stroke="${c2}" stroke-width="5"/>
    <line x1="30" y1="92" x2="70" y2="92" stroke="${c2}" stroke-width="5" stroke-linecap="round"/>
    <line x1="34" y1="80" x2="26" y2="92" stroke="${c2}" stroke-width="4"/>
    <line x1="66" y1="80" x2="74" y2="92" stroke="${c2}" stroke-width="4"/>`;
}
function renderElFilingCabinet(p) {
  const c = p.color || '#8a8f9c';
  const c2 = p.color2 || '#4a5568';
  return `<rect x="18" y="6" width="64" height="88" rx="4" fill="${c}"/>
    <rect x="24" y="14" width="52" height="20" fill="${c2}"/>
    <rect x="24" y="40" width="52" height="20" fill="${c2}"/>
    <rect x="24" y="66" width="52" height="20" fill="${c2}"/>
    <rect x="44" y="20" width="14" height="4" rx="2" fill="${c}"/>
    <rect x="44" y="46" width="14" height="4" rx="2" fill="${c}"/>
    <rect x="44" y="72" width="14" height="4" rx="2" fill="${c}"/>`;
}
function renderElWhiteboard(p) {
  const c = p.color || '#ffffff';
  const frame = p.color2 || '#8a8f9c';
  return `<rect x="6" y="10" width="88" height="60" rx="3" fill="${frame}"/>
    <rect x="12" y="16" width="76" height="48" fill="${c}"/>
    <line x1="22" y1="30" x2="60" y2="30" stroke="#4f7df3" stroke-width="3"/>
    <line x1="22" y1="42" x2="70" y2="42" stroke="#4f7df3" stroke-width="3"/>
    <line x1="22" y1="54" x2="48" y2="54" stroke="#4f7df3" stroke-width="3"/>
    <rect x="36" y="70" width="28" height="6" rx="2" fill="${frame}"/>`;
}
function renderElPenHolder(p) {
  const c = p.color || '#4f7df3';
  const pens = ['#e04f4f', '#f2b632', '#22c55e'];
  return `<path d="M 24,40 L 76,40 L 74,92 L 26,92 Z" fill="${c}"/>
    <ellipse cx="50" cy="40" rx="26" ry="6" fill="${c}" opacity="0.8"/>
    ${pens.map((pc, i) => `<rect x="${34 + i * 12}" y="${6 + i * 6}" width="6" height="${34 - i * 4}" fill="${pc}"/>`).join('')}`;
}
function renderElDocumentStack(p) {
  const c = p.color || '#ffffff';
  const line = p.color2 || '#8a8f9c';
  return `<rect x="14" y="10" width="72" height="88" fill="${c}" stroke="${line}" stroke-width="2" transform="rotate(-6 50 50)"/>
    <rect x="14" y="10" width="72" height="88" fill="${c}" stroke="${line}" stroke-width="2" transform="rotate(-2 50 50)"/>
    <rect x="14" y="10" width="72" height="88" fill="${c}" stroke="${line}" stroke-width="2"/>
    <line x1="24" y1="30" x2="76" y2="30" stroke="${line}" stroke-width="2"/>
    <line x1="24" y1="44" x2="76" y2="44" stroke="${line}" stroke-width="2"/>
    <line x1="24" y1="58" x2="60" y2="58" stroke="${line}" stroke-width="2"/>`;
}
function renderElOfficePlant(p) {
  const pot = p.color || '#b3432f';
  const leaf = p.color2 || '#4f9d5c';
  return `<path d="M 30,60 L 70,60 L 64,94 L 36,94 Z" fill="${pot}"/>
    <rect x="26" y="56" width="48" height="8" rx="2" fill="${pot}"/>
    <ellipse cx="50" cy="40" rx="8" ry="24" fill="${leaf}"/>
    <ellipse cx="34" cy="42" rx="7" ry="20" fill="${leaf}" transform="rotate(-30 34 42)"/>
    <ellipse cx="66" cy="42" rx="7" ry="20" fill="${leaf}" transform="rotate(30 66 42)"/>`;
}
function renderElPaperTray(p) {
  const c = p.color || '#2b2b40';
  const paper = p.color2 || '#ffffff';
  return `<rect x="8" y="44" width="84" height="10" rx="3" fill="${c}"/>
    <rect x="14" y="30" width="72" height="14" fill="${paper}" stroke="#c7d0dc" stroke-width="2"/>
    <rect x="16" y="20" width="68" height="10" fill="${paper}" stroke="#c7d0dc" stroke-width="2"/>
    <rect x="14" y="54" width="72" height="10" rx="2" fill="${c}" opacity="0.8"/>
    <rect x="14" y="64" width="72" height="10" rx="2" fill="${c}" opacity="0.6"/>`;
}

/* ---------- baby_kids ---------- */
function renderElBabyBottle(p) {
  const c = p.color || '#bfe3f5';
  const nipple = p.color2 || '#f2d9b8';
  return `<rect x="30" y="30" width="40" height="60" rx="10" fill="${c}" stroke="#4f9de0" stroke-width="3"/>
    <rect x="38" y="14" width="24" height="18" rx="4" fill="${c}" stroke="#4f9de0" stroke-width="3"/>
    <ellipse cx="50" cy="10" rx="10" ry="7" fill="${nipple}"/>
    <line x1="36" y1="46" x2="64" y2="46" stroke="#4f9de0" stroke-width="2" opacity="0.6"/>
    <line x1="36" y1="58" x2="64" y2="58" stroke="#4f9de0" stroke-width="2" opacity="0.6"/>
    <line x1="36" y1="70" x2="64" y2="70" stroke="#4f9de0" stroke-width="2" opacity="0.6"/>`;
}
function renderElTeddyBear(p) {
  const c = p.color || '#d9a441';
  const snout = p.color2 || '#f2d9b8';
  return `<circle cx="24" cy="18" r="12" fill="${c}"/>
    <circle cx="76" cy="18" r="12" fill="${c}"/>
    <circle cx="50" cy="38" r="30" fill="${c}"/>
    <ellipse cx="50" cy="44" rx="14" ry="11" fill="${snout}"/>
    <circle cx="50" cy="38" r="2.6" fill="#2b2b40"/>
    <circle cx="38" cy="32" r="3" fill="#2b2b40"/>
    <circle cx="62" cy="32" r="3" fill="#2b2b40"/>
    <ellipse cx="50" cy="76" rx="34" ry="22" fill="${c}"/>
    <circle cx="30" cy="76" r="8" fill="${snout}"/>
    <circle cx="70" cy="76" r="8" fill="${snout}"/>`;
}
function renderElBuildingBlocks(p) {
  const c1 = p.color || '#e04f4f';
  const c2 = p.color2 || '#4f7df3';
  return `<rect x="8" y="56" width="30" height="30" rx="3" fill="${c1}"/>
    <rect x="40" y="56" width="30" height="30" rx="3" fill="#f2b632"/>
    <rect x="24" y="22" width="30" height="30" rx="3" fill="${c2}"/>
    <text x="23" y="78" font-size="18" font-family="Arial, sans-serif" fill="#ffffff" font-weight="bold">A</text>
    <text x="55" y="78" font-size="18" font-family="Arial, sans-serif" fill="#ffffff" font-weight="bold">B</text>
    <text x="39" y="44" font-size="18" font-family="Arial, sans-serif" fill="#ffffff" font-weight="bold">C</text>`;
}
function renderElPacifier(p) {
  const c = p.color || '#f28ba8';
  const nipple = p.color2 || '#ffffff';
  return `<ellipse cx="50" cy="60" rx="8" ry="10" fill="${nipple}"/>
    <ellipse cx="50" cy="40" rx="26" ry="16" fill="${c}"/>
    <circle cx="50" cy="40" r="7" fill="#ffffff" opacity="0.5"/>
    <circle cx="50" cy="10" r="16" fill="none" stroke="${c}" stroke-width="6"/>`;
}
function renderElRattleToy(p) {
  const c = p.color || '#f2b632';
  const handle = p.color2 || '#4f7df3';
  return `<circle cx="34" cy="34" r="30" fill="${c}"/>
    <path d="M 22,22 L 26,32 L 16,30 L 24,38 L 14,44 L 26,44 L 22,54" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.7"/>
    <rect x="50" y="50" width="14" height="46" rx="7" fill="${handle}" transform="rotate(30 57 73)"/>`;
}
function renderElStroller(p) {
  const c = p.color || '#4f7df3';
  const wheel = p.color2 || '#2b2b40';
  return `<path d="M 30,30 C 50,20 70,26 74,44 L 34,50 Z" fill="${c}"/>
    <path d="M 74,44 L 88,20" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <path d="M 34,50 L 24,78 M 74,44 L 68,78" fill="none" stroke="${c}" stroke-width="5"/>
    <circle cx="24" cy="84" r="10" fill="none" stroke="${wheel}" stroke-width="5"/>
    <circle cx="68" cy="84" r="10" fill="none" stroke="${wheel}" stroke-width="5"/>`;
}
function renderElBabyCrib(p) {
  const c = p.color || '#f2d9b8';
  const rail = p.color2 || '#6d4a2f';
  return `<rect x="8" y="30" width="84" height="58" rx="4" fill="${c}"/>
    <rect x="8" y="30" width="84" height="8" fill="${rail}"/>
    <rect x="8" y="80" width="84" height="8" fill="${rail}"/>
    ${[0,1,2,3,4,5,6].map(i => `<line x1="${16 + i * 12}" y1="38" x2="${16 + i * 12}" y2="80" stroke="${rail}" stroke-width="3"/>`).join('')}
    <rect x="6" y="88" width="6" height="8" fill="${rail}"/>
    <rect x="88" y="88" width="6" height="8" fill="${rail}"/>`;
}
function renderElHighChair(p) {
  const c = p.color || '#4f7df3';
  const c2 = p.color2 || '#e04f4f';
  return `<path d="M 30,20 L 70,20 L 66,50 L 34,50 Z" fill="${c}"/>
    <rect x="24" y="50" width="52" height="8" fill="${c}"/>
    <rect x="30" y="58" width="40" height="8" fill="${c}"/>
    <line x1="34" y1="66" x2="22" y2="94" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <line x1="66" y1="66" x2="78" y2="94" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <rect x="24" y="44" width="52" height="8" fill="${c2}"/>
    <circle cx="50" cy="30" r="3" fill="${c2}"/>`;
}
function renderElBabyMonitor(p) {
  const c = p.color || '#c7d0dc';
  const c2 = p.color2 || '#4a5568';
  return `<rect x="8" y="40" width="44" height="44" rx="6" fill="${c}"/>
    <circle cx="30" cy="58" r="10" fill="${c2}"/>
    <circle cx="30" cy="58" r="4" fill="${c}"/>
    <circle cx="30" cy="76" r="3" fill="#22c55e"/>
    <rect x="58" y="30" width="34" height="58" rx="8" fill="${c2}"/>
    <rect x="64" y="38" width="22" height="34" rx="3" fill="#bfe3f5"/>
    <circle cx="75" cy="80" r="4" fill="${c}"/>
    <line x1="52" y1="60" x2="58" y2="60" stroke="${c2}" stroke-width="3"/>`;
}
function renderElRockingHorse(p) {
  const c = p.color || '#d9a441';
  const rail = p.color2 || '#6d4a2f';
  return `<path d="M 24,40 C 30,26 46,22 60,26 C 72,30 78,40 74,50 L 60,54 L 34,54 Z" fill="${c}"/>
    <circle cx="66" cy="30" r="3" fill="#2b2b40"/>
    <polygon points="34,30 24,22 30,36" fill="${c}"/>
    <line x1="34" y1="54" x2="30" y2="74" stroke="${c}" stroke-width="5"/>
    <line x1="60" y1="54" x2="64" y2="74" stroke="${c}" stroke-width="5"/>
    <path d="M 12,80 C 30,74 70,74 88,80" fill="none" stroke="${rail}" stroke-width="6" stroke-linecap="round"/>
    <line x1="30" y1="74" x2="26" y2="80" stroke="${rail}" stroke-width="3"/>
    <line x1="64" y1="74" x2="68" y2="80" stroke="${rail}" stroke-width="3"/>`;
}
function renderElToyDrum(p) {
  const c = p.color || '#e04f4f';
  const skin = p.color2 || '#f2d9b8';
  return `<ellipse cx="50" cy="34" rx="32" ry="14" fill="${skin}" stroke="#2b2b40" stroke-width="3"/>
    <rect x="18" y="34" width="64" height="40" fill="${c}"/>
    <ellipse cx="50" cy="74" rx="32" ry="14" fill="${c}" opacity="0.8"/>
    <line x1="22" y1="36" x2="22" y2="72" stroke="#2b2b40" stroke-width="2" opacity="0.4"/>
    <line x1="78" y1="36" x2="78" y2="72" stroke="#2b2b40" stroke-width="2" opacity="0.4"/>
    <path d="M 30,20 L 40,6 M 70,20 L 60,6" stroke="#f2b632" stroke-width="3" stroke-linecap="round"/>`;
}
function renderElPictureBook(p) {
  const c = p.color || '#4f7df3';
  const page = p.color2 || '#ffffff';
  return `<rect x="8" y="20" width="84" height="60" rx="3" fill="${c}"/>
    <rect x="14" y="26" width="34" height="48" fill="${page}"/>
    <rect x="52" y="26" width="34" height="48" fill="${page}"/>
    <circle cx="31" cy="46" r="8" fill="#f2b632"/>
    <path d="M 18,72 L 30,58 L 38,66 L 44,60 L 44,74 Z" fill="#22c55e"/>
    <rect x="58" y="36" width="22" height="4" fill="${c}"/>
    <rect x="58" y="46" width="22" height="4" fill="${c}"/>
    <rect x="58" y="56" width="16" height="4" fill="${c}"/>
    <line x1="50" y1="26" x2="50" y2="74" stroke="${c}" stroke-width="2"/>`;
}

/* ---------- agriculture ---------- */
function renderElTractor(p) {
  const body = p.color || '#22c55e';
  const wheel = p.color2 || '#2b2b40';
  return `<rect x="16" y="46" width="40" height="24" rx="4" fill="${body}"/>
    <rect x="22" y="20" width="26" height="28" rx="3" fill="${body}"/>
    <rect x="26" y="24" width="18" height="14" fill="#bfe3f5"/>
    <rect x="56" y="58" width="30" height="10" fill="${body}"/>
    <circle cx="30" cy="80" r="18" fill="none" stroke="${wheel}" stroke-width="7"/>
    <circle cx="78" cy="84" r="10" fill="none" stroke="${wheel}" stroke-width="5"/>`;
}
function renderElWheatStalk(p) {
  const c = p.color || '#f2b632';
  let heads = '';
  for (let i = 0; i < 6; i++) {
    const y = 10 + i * 8;
    const spread = 6 + (i % 2) * 2;
    heads += `<ellipse cx="${50 - spread}" cy="${y}" rx="6" ry="4" fill="${c}" transform="rotate(-30 ${50 - spread} ${y})"/>
      <ellipse cx="${50 + spread}" cy="${y}" rx="6" ry="4" fill="${c}" transform="rotate(30 ${50 + spread} ${y})"/>`;
  }
  return `<line x1="50" y1="8" x2="50" y2="96" stroke="#a4703a" stroke-width="4"/>${heads}`;
}
function renderElWateringCan(p) {
  const c = p.color || '#4f9de0';
  const handle = p.color2 || '#2f6fb3';
  return `<path d="M 20,44 L 66,44 C 74,44 80,52 80,60 L 80,80 C 80,88 74,94 66,94 L 30,94 C 22,94 16,88 16,80 L 16,54 C 16,48 18,44 20,44 Z" fill="${c}"/>
    <path d="M 66,50 L 92,36 L 96,42 L 74,58 Z" fill="${c}"/>
    <circle cx="94" cy="34" r="3" fill="${c}"/>
    <circle cx="88" cy="30" r="3" fill="${c}"/>
    <path d="M 30,44 C 30,30 46,30 46,44" fill="none" stroke="${handle}" stroke-width="5"/>`;
}
function renderElBarn(p) {
  const wall = p.color || '#e04f4f';
  const roof = p.color2 || '#4a5568';
  return `<polygon points="50,8 94,42 6,42" fill="${roof}"/>
    <rect x="14" y="42" width="72" height="48" fill="${wall}"/>
    <polygon points="50,20 76,42 24,42" fill="${wall}" opacity="0.85"/>
    <path d="M 40,90 L 40,62 C 40,54 60,54 60,62 L 60,90 Z" fill="#4a2c1e"/>
    <line x1="14" y1="60" x2="86" y2="60" stroke="#4a2c1e" stroke-width="2" opacity="0.5"/>`;
}
function renderElFarmerHat(p) {
  const c = p.color || '#d9a441';
  const band = p.color2 || '#6d4a2f';
  return `<ellipse cx="50" cy="66" rx="46" ry="12" fill="${c}"/>
    <path d="M 30,66 C 30,40 40,26 50,26 C 60,26 70,40 70,66 Z" fill="${c}"/>
    <rect x="32" y="58" width="36" height="8" fill="${band}"/>`;
}
function renderElIrrigationPipe(p) {
  const c = p.color || '#8a8f9c';
  const spray = p.color2 || '#4f9de0';
  return `<rect x="6" y="46" width="88" height="12" rx="4" fill="${c}"/>
    ${[20,46,72].map(x => `<rect x="${x}" y="30" width="8" height="16" fill="${c}"/>`).join('')}
    ${[24,50,76].map(x => [0,1,2].map(i => `<line x1="${x}" y1="30" x2="${x - 6 + i * 6}" y2="10" stroke="${spray}" stroke-width="3" stroke-linecap="round"/>`).join('')).join('')}`;
}
function renderElSeedPacket(p) {
  const c = p.color || '#d9a441';
  const c2 = p.color2 || '#4f9d5c';
  return `<path d="M 14,14 L 86,14 L 86,86 L 74,96 L 14,96 Z" fill="${c}"/>
    <path d="M 14,14 L 86,14 L 74,26 L 14,26 Z" fill="#8a5a2f"/>
    <circle cx="50" cy="60" r="18" fill="#ffffff" opacity="0.85"/>
    <path d="M 50,52 C 44,42 34,44 32,52 C 40,54 46,54 50,52 Z" fill="${c2}"/>
    <path d="M 50,52 C 56,42 66,44 68,52 C 60,54 54,54 50,52 Z" fill="${c2}"/>`;
}
function renderElHayBale(p) {
  const c = p.color || '#f2b632';
  const line = p.color2 || '#a4703a';
  return `<rect x="10" y="30" width="80" height="56" rx="8" fill="${c}"/>
    <line x1="10" y1="46" x2="90" y2="46" stroke="${line}" stroke-width="2" opacity="0.6"/>
    <line x1="10" y1="60" x2="90" y2="60" stroke="${line}" stroke-width="2" opacity="0.6"/>
    <line x1="10" y1="74" x2="90" y2="74" stroke="${line}" stroke-width="2" opacity="0.6"/>
    <line x1="30" y1="30" x2="30" y2="86" stroke="${line}" stroke-width="3" opacity="0.5"/>
    <line x1="70" y1="30" x2="70" y2="86" stroke="${line}" stroke-width="3" opacity="0.5"/>`;
}
function renderElShovel(p) {
  const c = p.color || '#8a8f9c';
  const handle = p.color2 || '#6d4a2f';
  return `<g transform="rotate(20 50 50)">
    <rect x="47" y="4" width="6" height="60" fill="${handle}"/>
    <path d="M 30,64 L 70,64 L 62,94 L 38,94 Z" fill="${c}"/>
    <rect x="42" y="54" width="16" height="10" fill="${handle}"/>
  </g>`;
}
function renderElPitchfork(p) {
  const c = p.color || '#8a8f9c';
  const handle = p.color2 || '#6d4a2f';
  return `<rect x="47" y="30" width="6" height="66" fill="${handle}"/>
    ${[0,1,2].map(i => `<line x1="${28 + i * 22}" y1="6" x2="${28 + i * 22}" y2="34" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`).join('')}
    <rect x="26" y="30" width="48" height="8" fill="${c}"/>`;
}
function renderElGreenhouse(p) {
  const c = p.color || '#bfe3f5';
  const frame = p.color2 || '#4a5568';
  return `<path d="M 50,8 L 92,42 L 92,92 L 8,92 L 8,42 Z" fill="${c}" opacity="0.85"/>
    <path d="M 50,8 L 92,42 L 92,92 L 8,92 L 8,42 Z" fill="none" stroke="${frame}" stroke-width="4"/>
    <line x1="50" y1="8" x2="50" y2="92" stroke="${frame}" stroke-width="2"/>
    <line x1="8" y1="42" x2="92" y2="42" stroke="${frame}" stroke-width="2"/>
    <line x1="8" y1="68" x2="92" y2="68" stroke="${frame}" stroke-width="2"/>`;
}
function renderElScarecrow(p) {
  const c = p.color || '#d9a441';
  const c2 = p.color2 || '#e04f4f';
  return `<line x1="50" y1="30" x2="50" y2="94" stroke="#6d4a2f" stroke-width="4"/>
    <line x1="20" y1="46" x2="80" y2="46" stroke="#6d4a2f" stroke-width="4"/>
    <circle cx="50" cy="26" r="14" fill="${c}"/>
    <rect x="34" y="40" width="32" height="30" fill="${c2}"/>
    <polygon points="50,4 74,20 26,20" fill="${c}"/>
    <circle cx="45" cy="24" r="2" fill="#2b2b40"/>
    <circle cx="55" cy="24" r="2" fill="#2b2b40"/>
    <path d="M 42,32 C 46,36 54,36 58,32" fill="none" stroke="#2b2b40" stroke-width="2"/>`;
}

/* ---------- space ---------- */
function renderElRocket(p) {
  const body = p.color || '#e04f4f';
  const window_ = p.color2 || '#bfe3f5';
  return `<path d="M 50,4 C 68,20 72,44 72,60 L 28,60 C 28,44 32,20 50,4 Z" fill="${body}"/>
    <circle cx="50" cy="38" r="11" fill="${window_}"/>
    <path d="M 28,60 L 12,84 L 28,78 Z" fill="${body}"/>
    <path d="M 72,60 L 88,84 L 72,78 Z" fill="${body}"/>
    <path d="M 40,60 L 40,80 L 50,94 L 60,80 L 60,60 Z" fill="#f2b632"/>`;
}
function renderElPlanetRinged(p) {
  const planet = p.color || '#d9a441';
  const ring = p.color2 || '#f2d9b8';
  return `<ellipse cx="50" cy="50" rx="46" ry="14" fill="none" stroke="${ring}" stroke-width="6" transform="rotate(-20 50 50)"/>
    <circle cx="50" cy="50" r="26" fill="${planet}"/>
    <ellipse cx="50" cy="50" rx="46" ry="14" fill="none" stroke="${ring}" stroke-width="6" stroke-dasharray="0 90 60" transform="rotate(-20 50 50)"/>`;
}
function renderElSatellite(p) {
  const body = p.color || '#8a8f9c';
  const panel = p.color2 || '#4f7df3';
  return `<rect x="38" y="38" width="24" height="24" rx="4" fill="${body}"/>
    <rect x="2" y="34" width="28" height="32" fill="${panel}"/>
    <rect x="70" y="34" width="28" height="32" fill="${panel}"/>
    <line x1="30" y1="50" x2="38" y2="50" stroke="${body}" stroke-width="4"/>
    <line x1="62" y1="50" x2="70" y2="50" stroke="${body}" stroke-width="4"/>
    <line x1="56" y1="38" x2="70" y2="14" stroke="${body}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="72" cy="10" r="6" fill="${body}"/>`;
}
function renderElAstronautHelmet(p) {
  const shell = p.color || '#e8ecf5';
  const visor = p.color2 || '#4f7df3';
  return `<circle cx="50" cy="50" r="44" fill="${shell}"/>
    <ellipse cx="50" cy="52" rx="30" ry="26" fill="${visor}"/>
    <ellipse cx="40" cy="42" rx="8" ry="6" fill="#ffffff" opacity="0.5"/>
    <rect x="6" y="46" width="14" height="14" rx="4" fill="${shell}" stroke="#c7d0dc" stroke-width="2"/>
    <rect x="80" y="46" width="14" height="14" rx="4" fill="${shell}" stroke="#c7d0dc" stroke-width="2"/>`;
}
function renderElMoonLander(p) {
  const c = p.color || '#f2b632';
  const leg = p.color2 || '#8a8f9c';
  return `<polygon points="34,30 66,30 78,58 22,58" fill="${c}"/>
    <rect x="40" y="14" width="20" height="18" fill="${c}"/>
    <circle cx="50" cy="22" r="6" fill="#4f9de0"/>
    <line x1="22" y1="58" x2="8" y2="90" stroke="${leg}" stroke-width="5" stroke-linecap="round"/>
    <line x1="78" y1="58" x2="92" y2="90" stroke="${leg}" stroke-width="5" stroke-linecap="round"/>
    <line x1="34" y1="58" x2="30" y2="90" stroke="${leg}" stroke-width="5" stroke-linecap="round"/>
    <line x1="66" y1="58" x2="70" y2="90" stroke="${leg}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="8" cy="92" r="6" fill="${leg}"/>
    <circle cx="92" cy="92" r="6" fill="${leg}"/>
    <circle cx="30" cy="92" r="6" fill="${leg}"/>
    <circle cx="70" cy="92" r="6" fill="${leg}"/>`;
}
function renderElStarField(p) {
  const c = p.color || '#f7c948';
  const positions = [[16, 20, 8], [42, 10, 6], [72, 18, 9], [88, 40, 6], [12, 56, 7], [50, 50, 10], [80, 70, 6], [30, 82, 8], [64, 88, 7]];
  return positions.map(([x, y, r]) => `<polygon points="${_elStarPoints(x, y, 4, r, r * 0.4)}" fill="${c}"/>`).join('');
}
function renderElTelescope(p) {
  const c = p.color || '#4a5568';
  const lens = p.color2 || '#bfe3f5';
  return `<g transform="rotate(-30 50 50)">
    <rect x="20" y="30" width="60" height="20" rx="4" fill="${c}"/>
    <rect x="76" y="26" width="14" height="28" rx="4" fill="${c}"/>
    <circle cx="86" cy="40" r="10" fill="${lens}"/>
    <rect x="14" y="34" width="10" height="12" rx="2" fill="${c}"/>
    <line x1="42" y1="50" x2="36" y2="80" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <line x1="58" y1="50" x2="64" y2="80" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <line x1="30" y1="86" x2="70" y2="86" stroke="${c}" stroke-width="4"/>
  </g>`;
}
function renderElCometSpace(p) {
  const c = p.color || '#bfe3f5';
  const tail = p.color2 || '#f7c948';
  return `<path d="M 84,18 L 4,50 L 30,46 L 16,64 L 42,58 L 40,80 Z" fill="${c}" opacity="0.65"/>
    <path d="M 84,18 L 20,50 L 34,48 L 24,62 L 44,58 L 44,72 Z" fill="${tail}" opacity="0.65"/>
    <circle cx="84" cy="18" r="12" fill="${tail}"/>
    <circle cx="84" cy="18" r="6" fill="#ffffff" opacity="0.6"/>`;
}
function renderElSpaceStation(p) {
  const c = p.color || '#c7d0dc';
  const panel = p.color2 || '#4f7df3';
  return `<rect x="36" y="42" width="28" height="16" rx="4" fill="${c}"/>
    <rect x="42" y="22" width="16" height="20" fill="${c}"/>
    <rect x="6" y="34" width="26" height="32" fill="${panel}"/>
    <rect x="68" y="34" width="26" height="32" fill="${panel}"/>
    <line x1="32" y1="50" x2="36" y2="50" stroke="${c}" stroke-width="4"/>
    <line x1="64" y1="50" x2="68" y2="50" stroke="${c}" stroke-width="4"/>
    <rect x="48" y="58" width="4" height="30" fill="${c}"/>`;
}
function renderElAlien(p) {
  const c = p.color || '#22c55e';
  return `<ellipse cx="50" cy="42" rx="30" ry="34" fill="${c}"/>
    <ellipse cx="34" cy="34" rx="7" ry="11" fill="#2b2b40" transform="rotate(-15 34 34)"/>
    <ellipse cx="66" cy="34" rx="7" ry="11" fill="#2b2b40" transform="rotate(15 66 34)"/>
    <circle cx="34" cy="32" r="3" fill="#ffffff"/>
    <circle cx="66" cy="32" r="3" fill="#ffffff"/>
    <path d="M 36,60 L 30,90 L 44,80 L 50,94 L 56,80 L 70,90 L 64,60 Z" fill="${c}"/>`;
}
function renderElUfo(p) {
  const body = p.color || '#8a8f9c';
  const dome = p.color2 || '#bfe3f5';
  return `<ellipse cx="50" cy="34" rx="20" ry="16" fill="${dome}"/>
    <ellipse cx="50" cy="52" rx="42" ry="16" fill="${body}"/>
    <ellipse cx="50" cy="48" rx="42" ry="10" fill="${body}" opacity="0.6"/>
    <circle cx="24" cy="52" r="3" fill="#f5c518"/>
    <circle cx="40" cy="55" r="3" fill="#f5c518"/>
    <circle cx="60" cy="55" r="3" fill="#f5c518"/>
    <circle cx="76" cy="52" r="3" fill="#f5c518"/>
    <path d="M 40,66 L 30,94 L 50,84 L 70,94 L 60,66 Z" fill="#f5c518" opacity="0.4"/>`;
}
function renderElConstellation(p) {
  const c = p.color || '#f7c948';
  const line = p.color2 || '#ffffff';
  const pts = [[14,24],[36,14],[58,32],[78,20],[72,52],[46,62],[24,52],[40,84],[70,80]];
  let out = '';
  const path = [[0,1],[1,2],[2,3],[1,5],[5,6],[6,0],[5,7],[7,8],[5,8]];
  path.forEach(([a, b]) => {
    out += `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}" stroke="${line}" stroke-width="1.5" opacity="0.6"/>`;
  });
  pts.forEach(([x, y]) => {
    out += `<circle cx="${x}" cy="${y}" r="3.5" fill="${c}"/>`;
  });
  return out;
}

/* ---------- emotions_faces ---------- */
function renderElFaceHappy(p) {
  const c = p.color || '#f2b632';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <circle cx="34" cy="42" r="5" fill="#2b2b40"/>
    <circle cx="66" cy="42" r="5" fill="#2b2b40"/>
    <path d="M 28,60 C 36,76 64,76 72,60" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>`;
}
function renderElFaceSad(p) {
  const c = p.color || '#4f9de0';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <circle cx="34" cy="44" r="5" fill="#2b2b40"/>
    <circle cx="66" cy="44" r="5" fill="#2b2b40"/>
    <path d="M 28,72 C 36,58 64,58 72,72" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>`;
}
function renderElFaceSurprised(p) {
  const c = p.color || '#f2b632';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <circle cx="34" cy="42" r="6" fill="#2b2b40"/>
    <circle cx="66" cy="42" r="6" fill="#2b2b40"/>
    <ellipse cx="50" cy="66" rx="10" ry="13" fill="#2b2b40"/>`;
}
function renderElFaceAngry(p) {
  const c = p.color || '#e04f4f';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <line x1="26" y1="34" x2="42" y2="42" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <line x1="74" y1="34" x2="58" y2="42" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <circle cx="34" cy="48" r="5" fill="#2b2b40"/>
    <circle cx="66" cy="48" r="5" fill="#2b2b40"/>
    <path d="M 30,74 C 38,64 62,64 70,74" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>`;
}
function renderElFaceLove(p) {
  const c = p.color || '#f28ba8';
  const heart = p.color2 || '#e04f4f';
  const hp = 'M 0,4 C -3,-2 -10,-2 -10,4 C -10,10 -4,13 0,17 C 4,13 10,10 10,4 C 10,-2 3,-2 0,4 Z';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <g transform="translate(34 34) scale(1.1)"><path d="${hp}" fill="${heart}"/></g>
    <g transform="translate(66 34) scale(1.1)"><path d="${hp}" fill="${heart}"/></g>
    <path d="M 28,60 C 36,76 64,76 72,60" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>`;
}
function renderElFaceSleepy(p) {
  const c = p.color || '#a855f7';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <path d="M 26,42 C 30,48 38,48 42,42" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <path d="M 58,42 C 62,48 70,48 74,42" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="50" cy="66" rx="8" ry="6" fill="#2b2b40"/>
    <text x="66" y="22" font-size="16" font-family="Georgia, serif" fill="#2b2b40" font-weight="bold">Z</text>
    <text x="76" y="12" font-size="11" font-family="Georgia, serif" fill="#2b2b40" font-weight="bold">z</text>`;
}
function renderElFaceWink(p) {
  const c = p.color || '#f2b632';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <path d="M 26,42 C 30,48 38,48 42,42" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <circle cx="66" cy="42" r="5" fill="#2b2b40"/>
    <path d="M 30,60 C 38,74 62,74 70,60" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>`;
}
function renderElFaceCool(p) {
  const c = p.color || '#f2b632';
  const glass = p.color2 || '#2b2b40';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <rect x="18" y="38" width="28" height="16" rx="6" fill="${glass}"/>
    <rect x="54" y="38" width="28" height="16" rx="6" fill="${glass}"/>
    <line x1="46" y1="46" x2="54" y2="46" stroke="${glass}" stroke-width="5"/>
    <path d="M 32,66 C 40,78 60,78 68,66" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>`;
}
function renderElFaceConfused(p) {
  const c = p.color || '#a855f7';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <circle cx="34" cy="44" r="4" fill="#2b2b40"/>
    <circle cx="66" cy="44" r="4" fill="#2b2b40"/>
    <path d="M 40,42 C 46,40 52,42 56,46" fill="none" stroke="#2b2b40" stroke-width="3" stroke-linecap="round"/>
    <path d="M 34,70 C 42,64 58,70 66,64" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <text x="74" y="28" font-size="22" font-family="Georgia, serif" fill="#2b2b40" font-weight="bold">?</text>`;
}
function renderElFaceCrying(p) {
  const c = p.color || '#4f9de0';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <circle cx="34" cy="44" r="4" fill="#2b2b40"/>
    <circle cx="66" cy="44" r="4" fill="#2b2b40"/>
    <path d="M 28,74 C 36,62 64,62 72,74" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <path d="M 34,50 C 30,60 32,66 34,66 C 38,66 38,58 34,50 Z" fill="#bfe3f5"/>
    <path d="M 66,50 C 62,60 64,66 66,66 C 70,66 70,58 66,50 Z" fill="#bfe3f5"/>`;
}
function renderElFaceLaughing(p) {
  const c = p.color || '#f2b632';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <path d="M 24,40 C 30,48 40,48 46,40" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <path d="M 54,40 C 60,48 70,48 76,40" fill="none" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>
    <path d="M 24,58 C 34,86 66,86 76,58 Z" fill="#2b2b40"/>
    <path d="M 34,66 L 66,66" stroke="#e04f4f" stroke-width="5"/>`;
}
function renderElFaceNeutral(p) {
  const c = p.color || '#c7d0dc';
  return `<circle cx="50" cy="50" r="44" fill="${c}"/>
    <circle cx="34" cy="44" r="5" fill="#2b2b40"/>
    <circle cx="66" cy="44" r="5" fill="#2b2b40"/>
    <line x1="34" y1="68" x2="66" y2="68" stroke="#2b2b40" stroke-width="5" stroke-linecap="round"/>`;
}

/* ---------- celebrations ---------- */
function renderElBirthdayCake(p) {
  const icing = p.color || '#f28ba8';
  const cake = p.color2 || '#f2d9b8';
  return `<rect x="14" y="54" width="72" height="34" rx="4" fill="${cake}"/>
    <path d="M 10,54 C 20,44 30,64 40,54 C 50,44 60,64 70,54 C 80,44 90,64 90,54 L 90,60 L 10,60 Z" fill="${icing}"/>
    <rect x="30" y="24" width="5" height="18" fill="#f2d9b8"/>
    <rect x="47" y="20" width="5" height="22" fill="#f2d9b8"/>
    <rect x="64" y="24" width="5" height="18" fill="#f2d9b8"/>
    <path d="M 32,24 C 30,18 34,16 32,10" fill="none" stroke="#f2b632" stroke-width="3" stroke-linecap="round"/>
    <path d="M 49,20 C 47,14 51,12 49,6" fill="none" stroke="#f2b632" stroke-width="3" stroke-linecap="round"/>
    <path d="M 66,24 C 64,18 68,16 66,10" fill="none" stroke="#f2b632" stroke-width="3" stroke-linecap="round"/>`;
}
function renderElPartyHat(p) {
  const c = p.color || '#a855f7';
  const dots = p.color2 || '#f2b632';
  return `<polygon points="50,4 78,90 22,90" fill="${c}"/>
    <circle cx="50" cy="30" r="4" fill="${dots}"/>
    <circle cx="42" cy="50" r="4" fill="${dots}"/>
    <circle cx="58" cy="50" r="4" fill="${dots}"/>
    <circle cx="36" cy="70" r="4" fill="${dots}"/>
    <circle cx="64" cy="70" r="4" fill="${dots}"/>
    <circle cx="50" cy="4" r="8" fill="${dots}"/>`;
}
function renderElGiftBox(p) {
  const box = p.color || '#e04f4f';
  const ribbon = p.color2 || '#f2b632';
  return `<rect x="14" y="40" width="72" height="52" rx="3" fill="${box}"/>
    <rect x="42" y="40" width="16" height="52" fill="${ribbon}"/>
    <rect x="10" y="26" width="80" height="18" rx="3" fill="${box}"/>
    <rect x="42" y="26" width="16" height="18" fill="${ribbon}"/>
    <path d="M 50,26 C 30,26 26,4 42,6 C 54,8 50,20 50,26 Z" fill="${ribbon}"/>
    <path d="M 50,26 C 70,26 74,4 58,6 C 46,8 50,20 50,26 Z" fill="${ribbon}"/>`;
}
function renderElFireworks(p) {
  const c1 = p.color || '#f2b632';
  const c2 = p.color2 || '#e04f4f';
  const palette = [c1, c2, '#4f7df3', '#22c55e'];
  let bursts = '';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x1 = 50 + Math.cos(a) * 14, y1 = 50 + Math.sin(a) * 14;
    const x2 = 50 + Math.cos(a) * 40, y2 = 50 + Math.sin(a) * 40;
    const col = palette[i % palette.length];
    bursts += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3" fill="${col}"/>`;
  }
  return bursts + `<circle cx="50" cy="50" r="6" fill="${c1}"/>`;
}
function renderElBalloonBunch(p) {
  const c = p.color || '#e04f4f';
  const c2 = p.color2 || '#f2b632';
  const palette = [c, c2, '#4f7df3', '#22c55e', '#a855f7'];
  const colors = palette.slice(0, 5);
  let balloons = '';
  colors.forEach((col, i) => {
    const x = 20 + i * 15, y = 20 + (i % 2) * 6;
    balloons += `<ellipse cx="${x}" cy="${y}" rx="12" ry="15" fill="${col}"/>
      <ellipse cx="${x - 4}" cy="${y - 5}" rx="3" ry="4" fill="#ffffff" opacity="0.5"/>`;
  });
  return balloons + `<path d="M 20,35 L 50,90 M 35,40 L 50,90 M 50,40 L 50,90 M 65,40 L 50,90 M 80,35 L 50,90" stroke="#8a8f9c" stroke-width="1.5" fill="none"/>`;
}
function renderElConfettiCannon(p) {
  const c = p.color || '#f2b632';
  const c2 = p.color2 || '#e04f4f';
  const palette = [c, c2, '#22c55e', '#4f7df3', '#a855f7'];
  let pieces = '';
  for (let i = 0; i < 16; i++) {
    const x = 44 + (i % 4) * 14 + (i > 7 ? 5 : 0);
    const y = 4 + Math.floor(i / 2) * 8;
    const rot = (i * 37) % 360;
    pieces += `<rect x="${x}" y="${y}" width="7" height="4" fill="${palette[i % palette.length]}" transform="rotate(${rot} ${x} ${y})"/>`;
  }
  return `<polygon points="10,90 26,52 34,56 18,94" fill="${c}"/>
    <rect x="18" y="46" width="16" height="10" rx="3" fill="${c2}"/>
    ${pieces}`;
}
function renderElPartyPopper(p) {
  const c = p.color || '#a855f7';
  const c2 = p.color2 || '#f2b632';
  const palette = [c2, '#e04f4f', '#22c55e', '#4f7df3'];
  let stars = '';
  for (let i = 0; i < 12; i++) {
    const x = 30 + Math.random() * 60;
    const y = 6 + Math.random() * 40;
    const r = 3 + Math.random() * 3;
    stars += `<polygon points="${_elStarPoints(x, y, 4, r, r * 0.4)}" fill="${palette[i % palette.length]}"/>`;
  }
  return `<polygon points="14,94 44,70 50,80 24,98" fill="${c}"/>
    ${stars}`;
}
function renderElCakeSlice(p) {
  const cake = p.color || '#f28ba8';
  const icing = p.color2 || '#ffffff';
  return `<polygon points="10,80 90,80 50,20" fill="${cake}"/>
    <path d="M 10,80 L 90,80 L 80,70 L 20,70 Z" fill="${icing}"/>
    <line x1="20" y1="70" x2="30" y2="40" stroke="${icing}" stroke-width="2" opacity="0.7"/>
    <line x1="50" y1="20" x2="50" y2="70" stroke="#c05878" stroke-width="2" opacity="0.5"/>
    <circle cx="36" cy="52" r="3" fill="#e04f4f"/>
    <circle cx="64" cy="52" r="3" fill="#e04f4f"/>
    <circle cx="50" cy="40" r="3" fill="#e04f4f"/>`;
}

/* ---------- religion_culture ---------- */
function renderElPrayerBeads(p) {
  const c = p.color || '#4a5568';
  const accent = p.color2 || '#f2b632';
  let beads = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const x = 50 + Math.cos(a) * 34, y = 46 + Math.sin(a) * 34;
    beads += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${c}"/>`;
  }
  return `${beads}<circle cx="50" cy="88" r="8" fill="${accent}"/>`;
}
function renderElLantern(p) {
  const c = p.color || '#f2b632';
  const frame = p.color2 || '#4a4a4a';
  return `<rect x="42" y="2" width="16" height="8" fill="${frame}"/>
    <line x1="50" y1="10" x2="50" y2="20" stroke="${frame}" stroke-width="3"/>
    <path d="M 30,20 L 70,20 L 76,40 L 76,72 L 24,72 L 24,40 Z" fill="${c}"/>
    <rect x="30" y="20" width="40" height="6" fill="${frame}"/>
    <rect x="24" y="66" width="52" height="6" fill="${frame}"/>
    <line x1="50" y1="30" x2="50" y2="62" stroke="${frame}" stroke-width="2" opacity="0.5"/>
    <rect x="40" y="72" width="20" height="10" fill="${frame}"/>
    <line x1="50" y1="82" x2="50" y2="94" stroke="${frame}" stroke-width="3"/>
    <circle cx="50" cy="96" r="4" fill="${frame}"/>`;
}
function renderElFestivalFlag(p) {
  const c1 = p.color || '#e04f4f';
  const c2 = p.color2 || '#f2b632';
  const palette = [c1, c2, '#4f7df3', '#22c55e', '#a855f7'];
  let flags = '';
  for (let i = 0; i < 5; i++) {
    const x = 8 + i * 18;
    flags += `<polygon points="${x},10 ${x + 16},10 ${x + 8},40" fill="${palette[i % palette.length]}"/>`;
  }
  return `<line x1="4" y1="10" x2="96" y2="10" stroke="#8a8f9c" stroke-width="3"/>${flags}`;
}
function renderElIncenseStick(p) {
  const stick = p.color || '#8a4a2f';
  const smoke = p.color2 || '#c7d0dc';
  return `<rect x="46" y="34" width="8" height="60" fill="${stick}"/>
    <circle cx="50" cy="32" r="4" fill="#e04f4f"/>
    <path d="M 50,26 C 42,18 56,14 48,4" fill="none" stroke="${smoke}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <path d="M 52,22 C 58,14 46,10 54,2" fill="none" stroke="${smoke}" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>
    <rect x="34" y="92" width="32" height="6" rx="2" fill="${stick}"/>`;
}
function renderElPrayerMat(p) {
  const c = p.color || '#2f7d6a';
  const arch = p.color2 || '#f2b632';
  return `<path d="M 14,92 L 14,44 C 14,24 34,8 50,8 C 66,8 86,24 86,44 L 86,92 Z" fill="${c}"/>
    <path d="M 30,92 L 30,50 C 30,34 42,24 50,24 C 58,24 70,34 70,50 L 70,92" fill="none" stroke="${arch}" stroke-width="3"/>
    <line x1="14" y1="92" x2="86" y2="92" stroke="${arch}" stroke-width="4"/>`;
}
function renderElTempleDome(p) {
  const c = p.color || '#f2b632';
  const base = p.color2 || '#b3432f';
  return `<path d="M 50,4 C 30,20 20,38 20,54 L 80,54 C 80,38 70,20 50,4 Z" fill="${c}"/>
    <line x1="50" y1="0" x2="50" y2="10" stroke="${c}" stroke-width="4"/>
    <circle cx="50" cy="0" r="3" fill="${c}"/>
    <rect x="14" y="54" width="72" height="36" fill="${base}"/>
    <rect x="44" y="68" width="12" height="22" rx="6" fill="#2b2b40"/>
    <line x1="20" y1="60" x2="80" y2="60" stroke="#8a2a1f" stroke-width="2" opacity="0.5"/>`;
}

/* ---------- insects_small_creatures ---------- */
function renderElButterfly(p) {
  const c = p.color || '#a855f7';
  const spot = p.color2 || '#f2b632';
  return `<path d="M 50,30 C 40,4 6,10 8,36 C 10,54 34,52 50,40 Z" fill="${c}"/>
    <path d="M 50,30 C 60,4 94,10 92,36 C 90,54 66,52 50,40 Z" fill="${c}"/>
    <path d="M 50,42 C 42,58 20,66 18,82 C 30,86 42,66 50,58 Z" fill="${c}" opacity="0.85"/>
    <path d="M 50,42 C 58,58 80,66 82,82 C 70,86 58,66 50,58 Z" fill="${c}" opacity="0.85"/>
    <circle cx="28" cy="24" r="5" fill="${spot}"/>
    <circle cx="72" cy="24" r="5" fill="${spot}"/>
    <rect x="47" y="24" width="6" height="46" rx="3" fill="#2b2b40"/>
    <circle cx="50" cy="20" r="6" fill="#2b2b40"/>`;
}
function renderElLadybug(p) {
  const c = p.color || '#e04f4f';
  return `<circle cx="50" cy="20" r="14" fill="#2b2b40"/>
    <path d="M 12,50 C 12,26 28,14 50,14 C 72,14 88,26 88,50 C 88,76 72,92 50,92 C 28,92 12,76 12,50 Z" fill="${c}"/>
    <line x1="50" y1="30" x2="50" y2="92" stroke="#2b2b40" stroke-width="3"/>
    <circle cx="34" cy="42" r="6" fill="#2b2b40"/>
    <circle cx="66" cy="42" r="6" fill="#2b2b40"/>
    <circle cx="30" cy="66" r="6" fill="#2b2b40"/>
    <circle cx="70" cy="66" r="6" fill="#2b2b40"/>`;
}
function renderElAnt(p) {
  const c = p.color || '#2b2b40';
  return `<circle cx="50" cy="24" r="12" fill="${c}"/>
    <circle cx="50" cy="50" r="14" fill="${c}"/>
    <ellipse cx="50" cy="80" rx="18" ry="16" fill="${c}"/>
    <line x1="38" y1="46" x2="14" y2="36" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="38" y1="54" x2="14" y2="58" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="62" y1="46" x2="86" y2="36" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="62" y1="54" x2="86" y2="58" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <line x1="42" y1="16" x2="34" y2="4" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <line x1="58" y1="16" x2="66" y2="4" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
}
function renderElBee(p) {
  const c = p.color || '#f2b632';
  const stripe = p.color2 || '#2b2b40';
  return `<ellipse cx="50" cy="60" rx="30" ry="26" fill="${c}"/>
    <path d="M 20,60 C 30,50 40,50 50,50 C 60,50 70,50 80,60 C 70,70 60,70 50,70 C 40,70 30,70 20,60 Z" fill="${stripe}"/>
    <ellipse cx="28" cy="42" rx="12" ry="8" fill="#ffffff" opacity="0.8" transform="rotate(-30 28 42)"/>
    <ellipse cx="72" cy="42" rx="12" ry="8" fill="#ffffff" opacity="0.8" transform="rotate(30 72 42)"/>
    <circle cx="36" cy="34" r="3" fill="#2b2b40"/>
    <circle cx="64" cy="34" r="3" fill="#2b2b40"/>`;
}
function renderElSpider(p) {
  const c = p.color || '#2b2b40';
  return `<circle cx="50" cy="56" r="20" fill="${c}"/>
    <circle cx="50" cy="30" r="10" fill="${c}"/>
    <line x1="34" y1="48" x2="14" y2="36" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <line x1="34" y1="56" x2="10" y2="56" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <line x1="34" y1="64" x2="14" y2="76" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <line x1="66" y1="48" x2="86" y2="36" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <line x1="66" y1="56" x2="90" y2="56" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <line x1="66" y1="64" x2="86" y2="76" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="46" cy="28" r="2" fill="#e04f4f"/>
    <circle cx="54" cy="28" r="2" fill="#e04f4f"/>
    <path d="M 30,56 L 50,70 L 70,56" fill="none" stroke="#e04f4f" stroke-width="2" opacity="0.7"/>`;
}
function renderElSnail(p) {
  const c = p.color || '#d9a441';
  const body = p.color2 || '#f2d9b8';
  let spiral = 'M 56,52 ';
  for (let i = 0; i < 40; i++) {
    const a = i * 0.4;
    const r = i * 0.55;
    spiral += `L ${(56 + Math.cos(a) * r).toFixed(1)},${(52 + Math.sin(a) * r).toFixed(1)} `;
  }
  return `<path d="M 8,78 C 8,68 20,60 34,60 L 74,60 C 86,60 92,68 92,78 C 92,84 86,88 76,88 L 20,88 C 12,88 8,84 8,78 Z" fill="${body}"/>
    <circle cx="56" cy="52" r="34" fill="${c}"/>
    <path d="${spiral}" fill="none" stroke="#8a5a2f" stroke-width="2"/>
    <line x1="18" y1="60" x2="18" y2="50" stroke="${body}" stroke-width="3"/>
    <line x1="24" y1="60" x2="24" y2="50" stroke="${body}" stroke-width="3"/>
    <circle cx="18" cy="50" r="2" fill="#2b2b40"/>
    <circle cx="24" cy="50" r="2" fill="#2b2b40"/>`;
}

/* ---------- hobbies_crafts ---------- */
function renderElPaintbrush(p) {
  const handle = p.color || '#4f7df3';
  const bristle = p.color2 || '#e04f4f';
  return `<g transform="rotate(45 50 50)">
    <rect x="42" y="4" width="16" height="50" rx="4" fill="${handle}"/>
    <rect x="40" y="54" width="20" height="10" fill="#c7d0dc"/>
    <path d="M 40,64 L 60,64 L 56,92 L 44,92 Z" fill="${bristle}"/>
  </g>`;
}
function renderElYarnBall(p) {
  const c = p.color || '#e04f4f';
  return `<circle cx="50" cy="50" r="42" fill="${c}"/>
    <path d="M 12,40 C 40,20 60,20 88,40" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.5"/>
    <path d="M 10,58 C 40,78 60,78 90,58" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.5"/>
    <path d="M 20,20 C 44,50 56,50 80,80" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.5"/>
    <path d="M 80,20 C 56,50 44,50 20,80" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.5"/>
    <path d="M 88,50 C 96,60 100,72 92,80" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
}
function renderElEasel(p) {
  const c = p.color || '#6d4a2f';
  const canvas = p.color2 || '#ffffff';
  return `<line x1="20" y1="96" x2="42" y2="20" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <line x1="80" y1="96" x2="58" y2="20" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <line x1="50" y1="96" x2="50" y2="50" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <line x1="26" y1="70" x2="74" y2="70" stroke="${c}" stroke-width="5"/>
    <rect x="30" y="14" width="40" height="46" fill="${canvas}" stroke="${c}" stroke-width="3"/>`;
}
function renderElKnittingNeedles(p) {
  const c = p.color || '#8a8f9c';
  const yarn = p.color2 || '#e04f4f';
  return `<g transform="rotate(-25 50 50)">
    <rect x="24" y="6" width="5" height="82" rx="2" fill="${c}"/>
    <circle cx="26.5" cy="6" r="4" fill="${c}"/>
    <rect x="68" y="6" width="5" height="82" rx="2" fill="${c}"/>
    <circle cx="70.5" cy="6" r="4" fill="${c}"/>
    <circle cx="50" cy="80" r="14" fill="${yarn}"/>
  </g>`;
}
function renderElSewingNeedle(p) {
  const c = p.color || '#c7d0dc';
  const thread = p.color2 || '#e04f4f';
  return `<g transform="rotate(-20 50 50)">
    <path d="M 50,6 L 54,6 L 52,78 L 50,94 L 48,78 Z" fill="${c}"/>
    <ellipse cx="52" cy="16" rx="1.5" ry="3" fill="#4a5568"/>
    <path d="M 52,16 C 76,26 82,50 68,72" fill="none" stroke="${thread}" stroke-width="2" stroke-linecap="round"/>
  </g>`;
}
function renderElCameraTripod(p) {
  const c = p.color || '#2b2b40';
  const head = p.color2 || '#8a8f9c';
  return `<rect x="36" y="20" width="28" height="22" rx="3" fill="${c}"/>
    <rect x="42" y="12" width="16" height="10" rx="3" fill="${head}"/>
    <circle cx="50" cy="31" r="7" fill="${head}"/>
    <rect x="46" y="42" width="8" height="18" fill="${c}"/>
    <line x1="50" y1="60" x2="24" y2="94" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <line x1="50" y1="60" x2="76" y2="94" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <line x1="50" y1="60" x2="50" y2="94" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;
}

/* ---------- marine_life ---------- */
function renderElFish(p) {
  const c = p.color || '#4f9de0';
  const fin = p.color2 || '#2f6fb3';
  return `<ellipse cx="42" cy="50" rx="34" ry="22" fill="${c}"/>
    <polygon points="76,50 96,32 96,68" fill="${fin}"/>
    <polygon points="34,32 46,14 54,32" fill="${fin}"/>
    <circle cx="24" cy="44" r="4" fill="#2b2b40"/>
    <path d="M 14,50 C 20,54 20,58 14,62" fill="none" stroke="${fin}" stroke-width="3" opacity="0.7"/>`;
}
function renderElSeashell(p) {
  const c = p.color || '#f2d9b8';
  const stripe = p.color2 || '#d9a441';
  return `<path d="M 50,10 C 20,30 14,70 50,94 C 86,70 80,30 50,10 Z" fill="${c}"/>
    <path d="M 50,20 C 50,20 50,60 50,90" fill="none" stroke="${stripe}" stroke-width="3" opacity="0.7"/>
    <path d="M 50,26 C 38,40 34,64 50,86" fill="none" stroke="${stripe}" stroke-width="3" opacity="0.7"/>
    <path d="M 50,26 C 62,40 66,64 50,86" fill="none" stroke="${stripe}" stroke-width="3" opacity="0.7"/>`;
}
function renderElWaveCrest(p) {
  const c = p.color || '#4f9de0';
  const foam = p.color2 || '#ffffff';
  return `<path d="M 2,60 C 18,30 30,30 40,50 C 50,70 62,70 72,50 C 82,30 94,30 98,50 L 98,96 L 2,96 Z" fill="${c}"/>
    <path d="M 2,60 C 18,30 30,30 40,50 C 50,70 62,70 72,50 C 82,30 94,30 98,50" fill="none" stroke="${foam}" stroke-width="4" stroke-linecap="round"/>`;
}
function renderElOctopus(p) {
  const c = p.color || '#a855f7';
  return `<ellipse cx="50" cy="34" rx="26" ry="24" fill="${c}"/>
    <path d="M 24,40 C 14,60 18,80 12,94 C 22,94 28,76 32,58 Z" fill="${c}" opacity="0.9"/>
    <path d="M 34,48 C 28,68 32,84 28,96 C 40,94 42,76 42,54 Z" fill="${c}" opacity="0.9"/>
    <path d="M 48,52 L 48,98 L 54,98 L 54,52 Z" fill="${c}" opacity="0.9"/>
    <path d="M 66,48 C 72,68 68,84 72,96 C 60,94 58,76 58,54 Z" fill="${c}" opacity="0.9"/>
    <path d="M 76,40 C 86,60 82,80 88,94 C 78,94 72,76 68,58 Z" fill="${c}" opacity="0.9"/>
    <circle cx="40" cy="32" r="4" fill="#ffffff"/>
    <circle cx="60" cy="32" r="4" fill="#ffffff"/>
    <circle cx="40" cy="32" r="2" fill="#2b2b40"/>
    <circle cx="60" cy="32" r="2" fill="#2b2b40"/>`;
}
function renderElAnchor(p) {
  const c = p.color || '#4a5568';
  return `<circle cx="50" cy="14" r="10" fill="none" stroke="${c}" stroke-width="6"/>
    <line x1="50" y1="24" x2="50" y2="88" stroke="${c}" stroke-width="6"/>
    <line x1="30" y1="38" x2="70" y2="38" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <path d="M 12,68 C 18,90 40,96 50,92 C 60,96 82,90 88,68" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <polygon points="12,68 4,58 18,58" fill="${c}"/>
    <polygon points="88,68 82,58 96,58" fill="${c}"/>`;
}
function renderElCoralBranch(p) {
  const c = p.color || '#f28ba8';
  return `<path d="M 50,96 C 50,70 46,52 34,34 C 28,24 22,14 18,6" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <path d="M 46,72 C 36,64 30,54 30,44" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <path d="M 50,84 C 62,78 72,66 74,52" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <path d="M 52,50 C 60,42 66,34 68,22" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="18" cy="6" r="5" fill="${c}"/>
    <circle cx="30" cy="44" r="5" fill="${c}"/>
    <circle cx="74" cy="52" r="5" fill="${c}"/>
    <circle cx="68" cy="22" r="5" fill="${c}"/>`;
}

/* ---------- seasons ---------- */
function renderElAutumnLeaf(p) {
  const c = p.color || '#d9734e';
  return `<path d="M 50,6 C 66,18 60,34 74,36 C 62,42 66,58 50,58 C 34,58 38,42 26,36 C 40,34 34,18 50,6 Z" fill="${c}"/>
    <line x1="50" y1="58" x2="50" y2="96" stroke="#8a4a2f" stroke-width="4"/>
    <line x1="50" y1="30" x2="50" y2="54" stroke="#8a4a2f" stroke-width="2" opacity="0.6"/>`;
}
function renderElSnowman(p) {
  const c = p.color || '#ffffff';
  const accent = p.color2 || '#e04f4f';
  return `<circle cx="50" cy="76" r="22" fill="${c}" stroke="#c7d0dc" stroke-width="2"/>
    <circle cx="50" cy="42" r="16" fill="${c}" stroke="#c7d0dc" stroke-width="2"/>
    <circle cx="50" cy="16" r="11" fill="${c}" stroke="#c7d0dc" stroke-width="2"/>
    <polygon points="50,18 62,14 50,10" fill="#f2b632"/>
    <circle cx="46" cy="38" r="2" fill="#2b2b40"/>
    <circle cx="54" cy="38" r="2" fill="#2b2b40"/>
    <circle cx="46" cy="72" r="2.6" fill="#2b2b40"/>
    <circle cx="54" cy="72" r="2.6" fill="#2b2b40"/>
    <circle cx="42" cy="80" r="2.6" fill="#2b2b40"/>
    <circle cx="58" cy="80" r="2.6" fill="#2b2b40"/>
    <rect x="30" y="4" width="40" height="8" rx="2" fill="${accent}"/>
    <rect x="34" y="0" width="32" height="8" fill="${accent}"/>`;
}
function renderElSpringSprout(p) {
  const c = p.color || '#4f9d5c';
  const soil = p.color2 || '#6d4a2f';
  return `<rect x="4" y="82" width="92" height="14" rx="3" fill="${soil}"/>
    <line x1="50" y1="82" x2="50" y2="42" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
    <path d="M 50,50 C 50,30 30,26 20,36 C 30,48 42,48 50,50 Z" fill="${c}"/>
    <path d="M 50,42 C 50,22 70,18 80,28 C 70,40 58,40 50,42 Z" fill="${c}"/>`;
}
function renderElWinterScarf(p) {
  const c = p.color || '#e04f4f';
  const c2 = p.color2 || '#f2b632';
  return `<path d="M 10,20 C 20,40 30,60 26,94 L 46,94 C 50,60 40,40 30,20 Z" fill="${c}"/>
    <path d="M 30,20 C 40,40 50,60 46,94 L 66,94 C 70,60 60,40 50,20 Z" fill="${c}"/>
    <path d="M 50,20 C 60,40 70,60 66,94 L 86,94 C 90,60 80,40 70,20 Z" fill="${c}"/>
    ${[0,1,2].map(i => `<line x1="${14 + i * 20}" y1="${34 + i * 4}" x2="${38 + i * 20}" y2="${34 + i * 4}" stroke="${c2}" stroke-width="4"/>`).join('')}
    ${[0,1,2].map(i => `<line x1="${14 + i * 20}" y1="${52 + i * 4}" x2="${38 + i * 20}" y2="${52 + i * 4}" stroke="${c2}" stroke-width="4"/>`).join('')}`;
}
function renderElRainBoots(p) {
  const c = p.color || '#f2b632';
  const c2 = p.color2 || '#2b2b40';
  return `<path d="M 20,20 L 42,20 L 42,64 C 42,74 56,76 56,86 L 56,94 L 18,94 L 18,86 C 18,80 20,74 20,64 Z" fill="${c}"/>
    <path d="M 54,20 L 76,20 L 76,64 C 76,74 90,76 90,86 L 90,94 L 52,94 L 52,86 C 52,80 54,74 54,64 Z" fill="${c}" opacity="0.9"/>
    <rect x="16" y="16" width="30" height="6" fill="${c2}"/>
    <rect x="50" y="16" width="30" height="6" fill="${c2}"/>
    <rect x="18" y="90" width="38" height="6" fill="${c2}"/>
    <rect x="52" y="90" width="40" height="6" fill="${c2}"/>`;
}
function renderElSummerSun(p) {
  const c = p.color || '#f5a623';
  const c2 = p.color2 || '#f7c948';
  let rays = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x1 = 50 + Math.cos(a) * 34, y1 = 50 + Math.sin(a) * 34;
    const x2 = 50 + Math.cos(a) * 48, y2 = 50 + Math.sin(a) * 48;
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c2}" stroke-width="5" stroke-linecap="round"/>`;
  }
  return `${rays}<circle cx="50" cy="50" r="28" fill="${c}"/>
    <circle cx="50" cy="50" r="20" fill="${c2}" opacity="0.5"/>`;
}

// ========================================================================
// SUBSTITUTION / DISPATCH
// ========================================================================
function renderElementById(id, paramString) {
  const found = _elFindElement(id);
  if (!found) return null;
  const p = _elParseParams(paramString);
  if (!p.color) p.color = found.element.defaultColor || '#4f7df3';
  try {
    const inner = found.element.render(p);
    const scale = (Number.isFinite(p.size) ? p.size : 100) / 100;
    const rotate = Number.isFinite(p.rotate) ? p.rotate : 0;
    const x = Number.isFinite(p.x) ? p.x : 0;
    const y = Number.isFinite(p.y) ? p.y : 0;
    return `<g transform="translate(${x} ${y}) scale(${scale}) rotate(${rotate} 50 50)">${inner}</g>`;
  } catch (e) {
    console.warn('[ElementLibrary] render failed for', id, e);
    return null;
  }
}

function injectElementTemplates(html) {
  if (!html || typeof html !== 'string' || html.indexOf('ELEMENT:') === -1) return html;
  return html.replace(/<!--\s*ELEMENT:([a-zA-Z0-9_]+):?([\s\S]*?)-->/g, function (match, id, paramString) {
    const g = renderElementById(id, paramString);
    return g || match;
  });
}

function getElementCatalogForPrompt() {
  const lines = Object.keys(ELEMENT_CATEGORIES).map(catKey => {
    const cat = ELEMENT_CATEGORIES[catKey];
    const ids = Object.keys(cat.elements).join(', ');
    return `    ${cat.label}: ${ids}`;
  });
  return lines.join('\n      ');
}

function getElementStats() {
  let n = 0;
  Object.keys(ELEMENT_CATEGORIES).forEach(k => { n += Object.keys(ELEMENT_CATEGORIES[k].elements).length; });
  return { categories: Object.keys(ELEMENT_CATEGORIES).length, elements: n };
}

// ============================================================
// WINDOW EXPOSURE
// ============================================================
window.ELEMENT_CATEGORIES = ELEMENT_CATEGORIES;
window.injectElementTemplates = injectElementTemplates;
window.getElementCatalogForPrompt = getElementCatalogForPrompt;
window.renderElementById = renderElementById;
window.getElementStats = getElementStats;

// ========================================================================
// PLANNING NOTES
//
// Current state: 39 categories, 376 elements total (every category doubled
// from its original size, as requested in this pass).
//
// Doubling breakdown (original count → new count):
//   sky_nature 7→14, weather 5→10, home_objects 6→12, desk_objects 7→14,
//   education 6→12, tech 7→14, icons_ui 3→6, icons_concept 3→6,
//   shapes_basic 6→12, shapes_decorative 6→12, backgrounds_scenic 5→10,
//   people_parts 4→8, science 4→8, finance 4→8, health 4→8, food 3→6,
//   travel 4→8, nature_plants 4→8, arrows_flow 4→8, communication 4→8,
//   awards 4→8, sports 5→10, music 5→10, kitchen 6→12, security 5→10,
//   time_calendar 4→8, buildings_infra 6→12, vehicles 7→14, office 7→14,
//   baby_kids 6→12, agriculture 6→12, space 6→12, emotions_faces 6→12,
//   celebrations 4→8, religion_culture 3→6, insects_small_creatures 3→6,
//   hobbies_crafts 3→6, marine_life 3→6, seasons 3→6
//
// Design rules kept consistent across all 188 new elements:
//   1. Every renderer works purely inside 0..100 x 0..100.
//   2. Every renderer reads params.color (with defaultColor fallback) and
//      uses params.color2 only for a genuine second tone.
//   3. All ids are unique, lowercase, underscore-separated English words;
//      no collisions with any pre-existing id in any category.
//   4. New elements register in ELEMENT_CATEGORIES only; the dispatch/
//      substitution/catalog functions are untouched and already handle
//      any addition.
// ========================================================================