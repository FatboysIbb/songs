(function () {
  const ROSTER_NAMES = ["Chef", "Hagen", "Nauber", "Mops", "Teeken", "Lage", "Pico", "Turtle", "Seppel"];
  const STATUS_VALUES = { full: 0, early: 1, late: 2, absent: 3 };
  const VALUE_STATUSES = ["full", "early", "late", "absent"];

  const ADJECTIVES = [
    "wilder", "frecher", "durstiger", "hungriger", "mueder", "flotter", "lauter", "leiser",
    "mutiger", "schlauer", "listiger", "froehlicher", "knuspriger", "sonniger", "salziger", "nasser",
    "trockener", "heisser", "kalter", "runder", "bunter", "goldener", "roter", "gruener",
    "blauer", "rasanter", "gemuetlicher", "tapferer", "ehrlicher", "verwirrter", "amtlicher", "heimlicher",
    "legendaerer", "majestaetischer", "sportlicher", "kritischer", "feierlicher", "spontaner", "dramatischer", "kreativer",
    "chaotischer", "prachtvoller", "zackiger", "lockerer", "seltener", "edler", "gluecklicher", "neugieriger",
    "grillender", "singender", "tanzender", "plantschender", "jubelnder", "reisender", "getarnter", "geheimer",
    "kichernder", "staunender", "entspannter", "wachsender", "fliegender", "rollender", "funkelnder", "verwegener"
  ];

  const CREATURES = [
    "dachs", "otter", "pinguin", "maulwurf", "kobold", "pirat", "kapitaen", "grillmeister",
    "biber", "frosch", "waschbaer", "hamster", "igel", "pelikan", "tukan", "walross",
    "seeloewe", "adler", "falke", "gecko", "panda", "yak", "alpaka", "flamingo",
    "hummer", "krabbe", "karpfen", "wels", "hecht", "delphin", "hai", "tintenfisch",
    "gockel", "stier", "widder", "hengst", "esel", "hase", "wolf", "luchs",
    "drache", "riese", "zwerg", "zauberer", "agent", "sheriff", "minister", "general",
    "hausmeister", "bademeister", "kellner", "koch", "saenger", "taenzer", "poet", "philosoph",
    "navigator", "reporter", "detektiv", "professor", "kaiser", "baron", "ritter", "astronaut"
  ];

  const VERBS = [
    "klaut", "tanzt", "grillt", "singt", "plantscht", "jubelt", "sucht", "bewacht",
    "rettet", "findet", "versteckt", "traegt", "wendet", "testet", "lobt", "prueft",
    "feiert", "erfindet", "bestellt", "vermisst", "entfuehrt", "adoptiert", "krallt", "zaehlt",
    "ruft", "malt", "filmt", "fotografiert", "serviert", "mischt", "schwenkt", "rollt",
    "besingt", "umarmt", "studiert", "bewertet", "ernennt", "kroent", "bejubelt", "kommentiert",
    "organisiert", "verhandelt", "erklaert", "zitiert", "plant", "tarnt", "entdeckt", "beschwoert",
    "poliert", "sortiert", "ignoriert", "bestaunt", "verfolgt", "verteidigt", "begruesst", "verabschiedet",
    "weckt", "beruhigt", "verwirrt", "beeindruckt", "ueberrascht", "protokolliert", "genehmigt", "kontrolliert"
  ];

  const OBJECTS = [
    "grillzange", "badeente", "bratwurst", "limonade", "handtuch", "sonnenbrille", "kuehlbox", "luftmatratze",
    "flaschenoeffner", "grillkohle", "senftube", "ketchup", "salatschuessel", "picknickdecke", "wasserball", "sonnenhut",
    "flipflop", "bademantel", "grillspiess", "maiskolben", "kartoffel", "gurke", "toastbrot", "marshmallow",
    "lagerfeuer", "musikbox", "playlist", "mikrofon", "tanzflaeche", "ehrenurkunde", "pokal", "krone",
    "kompass", "landkarte", "reisetasche", "zelthering", "klappstuhl", "campingtisch", "aschenbecher", "serviette",
    "eiswuerfel", "strohhalm", "kronkorken", "bierdeckel", "wasserglas", "kaffeetasse", "teekanne", "thermoskanne",
    "seeufer", "sprungbrett", "schwimmring", "wasserpistole", "sonnenuntergang", "wetterbericht", "gruppenfoto", "geheimakte",
    "wochenende", "mission", "maskottchen", "hymne", "tradition", "handschlag", "grillparty", "ehrenrunde"
  ];

  function secureSixBits() {
    return crypto.getRandomValues(new Uint8Array(1))[0] & 63;
  }

  function normalizeCode(value) {
    return value.toLowerCase().trim().replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function codeFromPacked(packed) {
    return [
      ADJECTIVES[(packed >>> 18) & 63],
      CREATURES[(packed >>> 12) & 63],
      VERBS[(packed >>> 6) & 63],
      OBJECTS[packed & 63]
    ].join("-");
  }

  function packedFromCode(value) {
    const words = normalizeCode(value).split("-");
    if (words.length !== 4) throw new Error("Die Game ID muss aus genau vier Wörtern bestehen.");
    const indices = [
      ADJECTIVES.indexOf(words[0]),
      CREATURES.indexOf(words[1]),
      VERBS.indexOf(words[2]),
      OBJECTS.indexOf(words[3])
    ];
    if (indices.some(index => index < 0)) throw new Error("Mindestens ein Wort der Game ID ist unbekannt.");
    return (indices[0] << 18) | (indices[1] << 12) | (indices[2] << 6) | indices[3];
  }

  function configFromRoster(roster) {
    let config = 0;
    ROSTER_NAMES.forEach(name => {
      const person = roster.find(entry => entry.name === name);
      if (!person || !(person.status in STATUS_VALUES)) throw new Error(`Keine Verfügbarkeit für ${name} gefunden.`);
      config = (config << 2) | STATUS_VALUES[person.status];
    });
    return config;
  }

  function rosterFromConfig(config) {
    const statuses = new Array(ROSTER_NAMES.length);
    for (let index = ROSTER_NAMES.length - 1; index >= 0; index -= 1) {
      statuses[index] = VALUE_STATUSES[config & 3];
      config >>>= 2;
    }
    return ROSTER_NAMES.map((name, index) => ({ name, status: statuses[index] }));
  }

  function create(roster) {
    const packed = (configFromRoster(roster) << 6) | secureSixBits();
    return { code: codeFromPacked(packed), packed };
  }

  function decode(code) {
    const packed = packedFromCode(code);
    return { code: codeFromPacked(packed), packed, roster: rosterFromConfig(packed >>> 6) };
  }

  function seededRandom(seed) {
    let state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  window.GameCodes = { ROSTER_NAMES, create, decode, normalizeCode, seededRandom };
}());
