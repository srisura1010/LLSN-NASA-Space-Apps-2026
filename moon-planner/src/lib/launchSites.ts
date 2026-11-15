// Earth launch sites offered by the launch-window estimate (src/lib/launchWindow.ts).
//
// Azimuths are degrees clockwise from true north, as flown relative to the
// ground. A range that crosses north is split in two, for example
// 349.5-360 and 0-91.5. `azimuthSource` says how far to trust the range:
//   "published"   a figure stated by the operator, a regulator or a standard
//                 reference, checked 2026-11-15 (source in `azimuthUrl`);
//   "approximate" a range reasoned from the site's geography, from a published
//                 inclination range, or a commonly quoted figure that could
//                 not be re-read at its primary source this session.
// See DATA_SOURCES.md at the repo root for the full source list.

export type SiteGroup = "us" | "nasa-partner" | "us-partner";

export type AzimuthRange = { min: number; max: number };

export type LaunchSite = {
  id: string;
  name: string;
  operator: string;
  country: string;
  group: SiteGroup;
  /** Degrees, north positive (geodetic, used as geocentric: error below 0.2 degrees). */
  lat: number;
  /** Degrees, east positive. */
  lon: number;
  /** One or two ranges, each with 0 <= min < max <= 360. */
  azimuths: AzimuthRange[];
  azimuthSource: "published" | "approximate";
  /** Where the azimuth range, or the figure it was reasoned from, comes from. */
  azimuthNote: string;
  /** Source for the site and its coordinates. */
  sourceUrl: string;
  /** Source for the azimuth range when it differs from `sourceUrl`. */
  azimuthUrl?: string;
};

export const GROUP_LABEL: Record<SiteGroup, string> = {
  us: "United States",
  "nasa-partner": "NASA partner agencies",
  "us-partner": "Other US partner countries",
};

export const launchSites: LaunchSite[] = [
  {
    id: "ksc",
    name: "Kennedy Space Center LC-39 / Cape Canaveral",
    operator: "NASA / US Space Force (Eastern Range)",
    country: "United States",
    group: "us",
    lat: 28.6083,
    lon: -80.6041,
    azimuths: [{ min: 35, max: 120 }],
    azimuthSource: "approximate",
    azimuthNote:
      "35-120 degrees is the long-quoted NASA figure for the Cape (not re-read at a primary source this session); the Eastern Range article gives 37-114. Apollo used 72-108.",
    sourceUrl: "https://en.wikipedia.org/wiki/Kennedy_Space_Center_Launch_Complex_39A",
    azimuthUrl: "https://en.wikipedia.org/wiki/Eastern_Range",
  },
  {
    id: "vandenberg",
    name: "Vandenberg SFB",
    operator: "US Space Force (Western Range)",
    country: "United States",
    group: "us",
    lat: 34.7513,
    lon: -120.5202,
    azimuths: [{ min: 158, max: 201 }],
    azimuthSource: "approximate",
    azimuthNote:
      "158-201 degrees is the commonly quoted range; consistent with the Minotaur I user's guide, which says inclinations below 72 degrees need a dogleg (azimuth 158 gives 72).",
    sourceUrl: "https://en.wikipedia.org/wiki/Vandenberg_Space_Force_Base",
    azimuthUrl: "https://www.manualsdir.com/manuals/569825/orbital-minotaur-i.html?page=26",
  },
  {
    id: "starbase",
    name: "Starbase (Boca Chica)",
    operator: "SpaceX",
    country: "United States",
    group: "us",
    lat: 25.9972,
    lon: -97.156,
    azimuths: [{ min: 85, max: 105 }],
    azimuthSource: "approximate",
    azimuthNote:
      "Reasoned from geography: flights leave over the Gulf of Mexico and thread the Straits of Florida or the Yucatan Channel, a narrow corridor close to due east.",
    sourceUrl: "https://en.wikipedia.org/wiki/SpaceX_Starbase",
  },
  {
    id: "wallops",
    name: "Wallops / Mid-Atlantic Regional Spaceport",
    operator: "NASA Wallops Flight Facility / Virginia Spaceport Authority",
    country: "United States",
    group: "us",
    lat: 37.8433,
    lon: -75.4781,
    azimuths: [{ min: 90, max: 160 }],
    azimuthSource: "approximate",
    azimuthNote:
      "90-160 degrees is the range quoted from the NASA Wallops Range User's Handbook (the PDF could not be read as text this session). The Minotaur I user's guide gives inclinations 37.8-55 degrees (azimuth 90 to about 133).",
    sourceUrl: "https://en.wikipedia.org/wiki/Mid-Atlantic_Regional_Spaceport",
    azimuthUrl: "https://www.nasa.gov/wp-content/uploads/2023/09/wallopsrangeusershandbook-2024.pdf",
  },
  {
    id: "kodiak",
    name: "Pacific Spaceport Complex - Alaska (Kodiak)",
    operator: "Alaska Aerospace Corporation",
    country: "United States",
    group: "us",
    lat: 57.4353,
    lon: -152.34,
    azimuths: [{ min: 110, max: 220 }],
    azimuthSource: "published",
    azimuthNote: "FAA spaceport listing: launch azimuths 110-220 degrees (inclinations 59-110 degrees).",
    sourceUrl: "https://en.wikipedia.org/wiki/Pacific_Spaceport_Complex_%E2%80%93_Alaska",
    azimuthUrl: "https://www.faa.gov/space/spaceports_by_state",
  },
  {
    id: "kourou",
    name: "Guiana Space Centre (Kourou)",
    operator: "ESA / CNES",
    country: "French Guiana (France)",
    group: "nasa-partner",
    lat: 5.169,
    lon: -52.6903,
    azimuths: [
      { min: 349.5, max: 360 },
      { min: 0, max: 91.5 },
    ],
    azimuthSource: "published",
    azimuthNote:
      "AIAA launch vehicle guide (Ariane): launch azimuth -10.5 to +91.5 degrees, inclinations 5.2-100.5 degrees. The Ariane 5 user's manual figure often quoted is -10.5 to +93.5.",
    sourceUrl: "https://en.wikipedia.org/wiki/Guiana_Space_Centre",
    azimuthUrl: "https://aiaa.org/vehicle-guide/vehicles/ariane",
  },
  {
    id: "tanegashima",
    name: "Tanegashima Space Center",
    operator: "JAXA",
    country: "Japan",
    group: "nasa-partner",
    lat: 30.4,
    lon: 130.975,
    azimuths: [{ min: 85, max: 125 }],
    azimuthSource: "approximate",
    azimuthNote:
      "Reasoned from geography and practice: east to south-east over the Pacific; higher inclinations are flown south-east with a dogleg (AIAA guide, H-IIA).",
    sourceUrl: "https://en.wikipedia.org/wiki/Tanegashima_Space_Center",
    azimuthUrl: "https://aiaa.org/vehicle-guide/vehicles/h-iia-h-iib/performance",
  },
  {
    id: "uchinoura",
    name: "Uchinoura Space Center",
    operator: "JAXA",
    country: "Japan",
    group: "nasa-partner",
    lat: 31.2511,
    lon: 131.0811,
    azimuths: [{ min: 80, max: 150 }],
    azimuthSource: "approximate",
    azimuthNote: "Reasoned from geography: the pad faces open Pacific from east to south-south-east.",
    sourceUrl: "https://en.wikipedia.org/wiki/Uchinoura_Space_Center",
  },
  {
    id: "sriharikota",
    name: "Satish Dhawan Space Centre (Sriharikota)",
    operator: "ISRO",
    country: "India",
    group: "nasa-partner",
    lat: 13.7199,
    lon: 80.2305,
    azimuths: [{ min: 102, max: 140 }],
    azimuthSource: "approximate",
    azimuthNote:
      "102-140 degrees is the commonly quoted corridor (140 keeps the flight path clear of Sri Lanka); not re-read at an ISRO source this session.",
    sourceUrl: "https://en.wikipedia.org/wiki/Satish_Dhawan_Space_Centre",
  },
  {
    id: "naro",
    name: "Naro Space Center",
    operator: "KARI",
    country: "South Korea",
    group: "nasa-partner",
    lat: 34.4319,
    lon: 127.535,
    azimuths: [{ min: 165, max: 175 }],
    azimuthSource: "approximate",
    azimuthNote:
      "Reasoned from geography: a narrow corridor just east of south between Japan and China, about 170 degrees.",
    sourceUrl: "https://en.wikipedia.org/wiki/Naro_Space_Center",
  },
  {
    id: "mahia",
    name: "Rocket Lab Launch Complex 1 (Mahia)",
    operator: "Rocket Lab",
    country: "New Zealand",
    group: "us-partner",
    lat: -39.2608,
    lon: 177.8658,
    azimuths: [{ min: 90, max: 220 }],
    azimuthSource: "approximate",
    azimuthNote:
      "Derived from Rocket Lab's quoted inclination range of about 39-120 degrees: due east round through south to south-west over open ocean.",
    sourceUrl: "https://en.wikipedia.org/wiki/Rocket_Lab_Launch_Complex_1",
  },
  {
    id: "arnhem",
    name: "Arnhem Space Centre",
    operator: "Equatorial Launch Australia",
    country: "Australia",
    group: "us-partner",
    lat: -12.378,
    lon: 136.822,
    azimuths: [{ min: 45, max: 110 }],
    azimuthSource: "approximate",
    azimuthNote: "Reasoned from geography: north-east to east-south-east over the Gulf of Carpentaria.",
    sourceUrl: "https://en.wikipedia.org/wiki/Arnhem_Space_Centre",
  },
  {
    id: "andoya",
    name: "Andøya Spaceport",
    operator: "Andøya Space",
    country: "Norway",
    group: "us-partner",
    lat: 69.108,
    lon: 15.59,
    azimuths: [
      { min: 300, max: 360 },
      { min: 0, max: 5 },
    ],
    azimuthSource: "published",
    azimuthNote: "Operator: launch azimuths between -60 and +5 degrees, orbital inclinations 90-110.6 degrees.",
    sourceUrl: "https://andoyaspace.no/spaceport/efficient-way-to-space/",
  },
  {
    id: "esrange",
    name: "Esrange Space Center",
    operator: "Swedish Space Corporation",
    country: "Sweden",
    group: "us-partner",
    lat: 67.8935,
    lon: 21.1066,
    azimuths: [
      { min: 340, max: 360 },
      { min: 0, max: 10 },
    ],
    azimuthSource: "approximate",
    azimuthNote:
      "Reasoned from geography: an inland site launching north over sparsely populated land towards the Norwegian and Barents seas, for polar and sun-synchronous orbits.",
    sourceUrl: "https://en.wikipedia.org/wiki/Esrange",
    azimuthUrl:
      "https://www.luftfartstilsynet.no/globalassets/dokumenter/romfart/report_orbital-launches-from-esrange-space-center.pdf",
  },
  {
    id: "saxavord",
    name: "SaxaVord Spaceport",
    operator: "SaxaVord UK Spaceport",
    country: "United Kingdom",
    group: "us-partner",
    lat: 60.817,
    lon: -0.768,
    azimuths: [
      { min: 330, max: 360 },
      { min: 0, max: 20 },
    ],
    azimuthSource: "approximate",
    azimuthNote:
      "Reasoned from geography: north over the Norwegian Sea between the Faroe Islands and Norway, for polar and sun-synchronous orbits.",
    sourceUrl: "https://en.wikipedia.org/wiki/SaxaVord_Spaceport",
  },
  {
    id: "alcantara",
    name: "Alcântara Space Center",
    operator: "Brazilian Air Force / Brazilian Space Agency",
    country: "Brazil",
    group: "us-partner",
    lat: -2.3394,
    lon: -44.4175,
    azimuths: [
      { min: 345, max: 360 },
      { min: 0, max: 95 },
    ],
    azimuthSource: "approximate",
    azimuthNote:
      "Derived from the quoted inclination range of about 2-100 degrees: north-north-west round to east over the open Atlantic.",
    sourceUrl: "https://en.wikipedia.org/wiki/Alc%C3%A2ntara_Space_Center",
    azimuthUrl: "https://daviddarling.info/encyclopedia/A/Alcantara.html",
  },
];

export const launchSiteById = (id: string): LaunchSite | undefined => launchSites.find((s) => s.id === id);
