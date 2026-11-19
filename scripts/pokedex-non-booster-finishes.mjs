// English booster expansions with an extra, plain-looking normal or holo printing.
// Keys are set ID and printed collector number. Sources identify the separate product
// (or the official booster checklist). Keep variant IDs stable for saved ownership.
export const nonBoosterFinishes = new Map([
  ["dp3:1", "normal"], // Ampharos — https://www.tcgplayer.com/product/168357
  ["dp3:20", "normal"], // Venusaur — https://www.tcgplayer.com/product/123444
  ["dp4:6", "normal"], // Porygon-Z — https://www.tcgplayer.com/product/168358
  ["dp6:5", "normal"], // Gliscor — https://www.tcgplayer.com/product/123630
  ["dp6:9", "normal"], // Mamoswine — https://www.tcgplayer.com/product/92415
  ["dp6:10", "normal"], // Metagross — https://www.tcgplayer.com/product/92416
  ["dp6:17", "normal"], // Yanmega — https://www.tcgplayer.com/product/93183
  ["dp7:10", "normal"], // Sceptile — https://www.tcgplayer.com/product/123628
  ["ex10:4", "normal"], // Feraligatr — https://www.tcgplayer.com/product/557368
  ["ex10:9", "normal"], // Meganium — https://www.tcgplayer.com/product/125051
  ["ex10:13", "normal"], // Slowbro — https://www.tcgplayer.com/product/557367
  ["ex10:17", "normal"], // Typhlosion — https://www.tcgplayer.com/product/97709
  ["ex13:21", "holo"], // Latias δ — https://www.tcgplayer.com/product/97087
  ["ex13:22", "holo"], // Latios δ — https://www.tcgplayer.com/product/97088
  ["ex13:111", "normal"], // Mew — https://www.tcgplayer.com/product/162457
  ["ex14:5", "normal"], // Dugtrio — https://www.tcgplayer.com/product/177126
  ["ex16:8", "normal"], // Delcatty — https://www.tcgplayer.com/product/177121
  ["ex16:9", "normal"], // Gardevoir — https://www.tcgplayer.com/product/177122
  ["ex2:93", "holo"], // Multi Energy — https://www.tcgplayer.com/product/228157
  ["ex4:3", "normal"], // Team Aqua's Kyogre — https://www.tcgplayer.com/product/125256
  ["ex4:9", "normal"], // Team Magma's Groudon — https://www.tcgplayer.com/product/125255
  ["ex5:11", "normal"], // Metagross — https://www.tcgplayer.com/product/125058
  ["ex7:1", "normal"], // Azumarill — https://www.tcgplayer.com/product/125066
  ["ex7:7", "normal"], // Dark Marowak — https://www.tcgplayer.com/product/125065
  ["ex8:4", "normal"], // Camerupt — https://www.tcgplayer.com/product/84089
  ["ex8:14", "normal"], // Shedinja — https://www.tcgplayer.com/product/228156
  ["ex9:1", "normal"], // Blaziken — https://www.tcgplayer.com/product/97710
  ["ex9:7", "normal"], // Manectric — https://www.tcgplayer.com/product/97711
  ["ex9:10", "normal"], // Sceptile — https://www.tcgplayer.com/product/88947
  ["ex9:11", "normal"], // Swampert — https://www.tcgplayer.com/product/89678
  ["hgss1:1", "normal"], // Arcanine — https://www.tcgplayer.com/product/125039
  ["hgss1:8", "normal"], // Noctowl — https://www.tcgplayer.com/product/125037
  ["hgss2:5", "normal"], // Mismagius — https://www.tcgplayer.com/product/125048
  ["hgss2:24", "holo"], // Steelix — https://www.tcgplayer.com/product/125050
  ["hgss3:1", "normal"], // Bellossom — https://www.tcgplayer.com/product/125047
  ["hgss3:2", "normal"], // Espeon — https://www.tcgplayer.com/product/125043
  ["hgss3:9", "normal"], // Togekiss — https://www.tcgplayer.com/product/125046
  ["hgss3:10", "normal"], // Umbreon — https://www.tcgplayer.com/product/125045
  ["hgss4:3", "normal"], // Celebi — https://www.tcgplayer.com/product/276387
  ["hgss4:5", "normal"], // Mamoswine — https://www.tcgplayer.com/product/125069
  ["hgss4:6", "normal"], // Nidoking — https://www.tcgplayer.com/product/125072
  ["hgss4:11", "normal"], // Venomoth — https://www.tcgplayer.com/product/125070
  ["lc:3", "normal"], // Charizard — https://www.tcgplayer.com/product/118404
  ["lc:4", "normal"], // Dark Blastoise — https://www.tcgplayer.com/product/125088
  ["lc:7", "normal"], // Dark Raichu — https://www.tcgplayer.com/product/125089
  ["me01:010", "normal"], // Meganium — https://www.tcgplayer.com/product/657454
  ["me01:064", "normal"], // Xerneas — https://www.tcgplayer.com/product/657455
  ["me01:073", "normal"], // Hariyama — https://www.tcgplayer.com/product/657456
  ["me02:014", "normal"], // Moltres — https://www.tcgplayer.com/product/664004
  ["me02:045", "normal"], // Zacian — https://www.tcgplayer.com/product/664005
  ["me02:053", "normal"], // Flygon — https://www.tcgplayer.com/product/664006
  ["me02:068", "normal"], // Toxtricity — https://www.tcgplayer.com/product/663937
  ["me03:006", "normal"], // Serperior — https://www.tcgplayer.com/product/689165
  ["me03:041", "normal"], // Landorus — https://www.tcgplayer.com/product/689164
  ["me03:045", "normal"], // Tyrantrum — https://www.tcgplayer.com/product/688902
  ["me03:086", "normal"], // Growing Grass Energy — https://www.tcgplayer.com/product/689163
  ["me03:087", "normal"], // Rocky Fighting Energy — https://www.tcgplayer.com/product/688898
  ["me03:088", "normal"], // Telepathic Psychic Energy — https://www.tcgplayer.com/product/705021
  ["me04:013", "normal"], // Delphox — https://www.tcgplayer.com/product/694632
  ["me04:029", "normal"], // Ampharos — https://www.tcgplayer.com/product/694633
  ["me04:051", "normal"], // Crobat — https://www.tcgplayer.com/product/694636
  ["me04:068", "normal"], // Goodra — https://www.tcgplayer.com/product/694638
  ["me04:085", "normal"], // Magnetic Metal Energy — https://www.tcgplayer.com/product/707308
  ["me05:028", "normal"], // Miraidon — https://www.tcgplayer.com/product/707026
  ["me05:035", "normal"], // Spiritomb — https://www.tcgplayer.com/product/707028
  ["me05:062", "normal"], // Bastiodon — https://www.tcgplayer.com/product/707025
  ["me05:070", "normal"], // Silvally — https://www.tcgplayer.com/product/707027
  ["me05:084", "normal"], // Voltaic Lightning Energy — https://www.tcgplayer.com/product/707029
  ["pl1:8", "normal"], // Gardevoir — https://www.tcgplayer.com/product/125076
  ["pl1:38", "holo"], // Shaymin — https://www.tcgplayer.com/product/125077
  ["pl2:5", "normal"], // Flygon — https://www.tcgplayer.com/product/125054
  ["pl2:8", "normal"], // Lucario GL — https://www.tcgplayer.com/product/479910
  ["pl2:32", "holo"], // Rhyperior E4 — https://www.tcgplayer.com/product/125053
  ["pl2:109", "normal"], // Luxray GL LV.X — https://www.tcgplayer.com/product/479913
  ["pl3:35", "holo"], // Milotic C — https://www.tcgplayer.com/product/125074
  ["pl4:5", "normal"], // Luxray — https://www.tcgplayer.com/product/125055
  ["pl4:9", "normal"], // Swalot — https://www.tcgplayer.com/product/125057
  ["pl4:10", "normal"], // Tangrowth — https://www.tcgplayer.com/product/125056
  ["sm3:18", "holo"], // Charmander — https://www.tcgplayer.com/product/148153
  ["sm3:19", "holo"], // Charmeleon — https://www.tcgplayer.com/product/138484
  ["sv03:026", "holo"], // Charmander — https://www.tcgplayer.com/product/523955
  ["sv03:027", "holo"], // Charmeleon — https://www.tcgplayer.com/product/523956
  ["sv05:041", "normal"], // Feraligatr — https://www.tcgplayer.com/product/543956
  ["sv05:062", "normal"], // Iron Thorns — https://www.tcgplayer.com/product/543961
  ["sv05:084", "normal"], // Relicanth — https://www.tcgplayer.com/product/543959
  ["sv05:119", "normal"], // Koraidon — https://www.tcgplayer.com/product/543957
  ["sv05:121", "normal"], // Miraidon — https://www.tcgplayer.com/product/543960
  ["sv06:033", "normal"], // Infernape — https://www.tcgplayer.com/product/551684
  ["sv06:053", "normal"], // Froslass — https://www.tcgplayer.com/product/551685
  ["sv06:059", "holo"], // Finizen — https://www.tcgplayer.com/product/560090
  ["sv06:060", "holo"], // Palafin — https://www.tcgplayer.com/product/560091
  ["sv06:095", "normal"], // Munkidori — https://www.tcgplayer.com/product/551686
  ["sv06:096", "normal"], // Fezandipiti — https://www.tcgplayer.com/product/552442
  ["sv06:100", "normal"], // Hisuian Arcanine — https://www.tcgplayer.com/product/693138
  ["sv06:111", "normal"], // Okidogi — https://www.tcgplayer.com/product/551683
  ["sv07:003", "normal"], // Ledian — https://www.tcgplayer.com/product/576968
  ["sv07:119", "normal"], // Bouffalant — https://www.tcgplayer.com/product/576969
  ["sv08:014", "normal"], // Rabsca — https://www.tcgplayer.com/product/594469
  ["sv08:038", "normal"], // Gouging Fire — https://www.tcgplayer.com/product/594470
  ["sv08:065", "normal"], // Tapu Koko — https://www.tcgplayer.com/product/594471
  ["sv09:055", "normal"], // Iono's Kilowattrel — https://www.tcgplayer.com/product/629834
  ["sv09:128", "normal"], // Noivern — https://www.tcgplayer.com/product/629760
  ["sv10:020", "normal"], // Team Rocket's Spidops — https://www.tcgplayer.com/product/682473
  ["sv10:034", "normal"], // Ethan's Typhlosion — https://www.tcgplayer.com/product/637651
  ["sv10:049", "normal"], // Misty's Gyarados — https://www.tcgplayer.com/product/635481
  ["sv10:051", "normal"], // Team Rocket's Articuno — https://www.tcgplayer.com/product/693139
  ["sv10:096", "normal"], // Team Rocket's Tyranitar — https://www.tcgplayer.com/product/637652
  ["swsh2:3", "holo"], // Butterfree — https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/checklist/swsh2_web_cardlist_en.pdf
  ["swsh4:121", "normal"], // Dialga — https://www.tcgplayer.com/product/270101
  ["swsh7:16", "normal"], // Eldegoss — https://www.tcgplayer.com/product/247422
]);
