# Aesop US signature stores. Compiled from Aesop's public store-locator pages
# (aesop.com/stores/us/..., shop.aesop.com/r/...) surfaced via web search, since
# the locator API host is not reachable from this environment.
# Coordinates: mall-anchored stores reuse the surveyed mall coordinate from the
# Apple dataset (same centre, <100m); street stores are placed at the street
# address / block. Accuracy is street-level, not rooftop.
import json
S = [
 # name, address, city, state, lat, lon
 ("Aesop Nolita","232 Elizabeth Street","New York","NY",40.72246,-73.99446),
 ("Aesop Bleecker Street","341 Bleecker Street","New York","NY",40.73427,-74.00437),
 ("Aesop West Broadway","419 West Broadway","New York","NY",40.72530,-74.00260),
 ("Aesop Gansevoort Street","46 Gansevoort Street","New York","NY",40.73930,-74.00680),
 ("Aesop NoMad","1140 Broadway","New York","NY",40.74470,-73.98860),
 ("Aesop Rockefeller Center","45 Rockefeller Plaza","New York","NY",40.75910,-73.97850),
 ("Aesop Hudson Yards","20 Hudson Yards","New York","NY",40.75390,-74.00190),
 ("Aesop World Trade Center","Westfield WTC / The Oculus","New York","NY",40.71180,-74.01090),
 ("Aesop Madison Avenue","967 Madison Avenue","New York","NY",40.77410,-73.96370),
 ("Aesop Upper East Side","Lexington Avenue","New York","NY",40.77480,-73.96070),
 ("Aesop Upper West Side","Amsterdam Avenue","New York","NY",40.78100,-73.97960),
 ("Aesop Bergen Street","Flatbush Avenue at Bergen","Brooklyn","NY",40.68130,-73.97710),
 ("Aesop Park Slope","Seventh Avenue","Brooklyn","NY",40.67450,-73.98230),
 ("Aesop Williamsburg","91 North 3rd Street","Brooklyn","NY",40.71800,-73.96200),
 ("Aesop Roosevelt Field","Roosevelt Field","Garden City","NY",40.73797,-73.61231),

 ("Aesop Century City","Westfield Century City","Los Angeles","CA",34.05855,-118.41812),
 ("Aesop Downtown LA","Spring Street","Los Angeles","CA",34.04570,-118.25040),
 ("Aesop Silver Lake","Sunset Boulevard","Los Angeles","CA",34.09220,-118.27740),
 ("Aesop Fairfax","North Fairfax Avenue","Los Angeles","CA",34.08040,-118.36150),
 ("Aesop Larchmont","North Larchmont Boulevard","Los Angeles","CA",34.07500,-118.32420),
 ("Aesop Studio City","Ventura Boulevard","Los Angeles","CA",34.14330,-118.39610),
 ("Aesop Pacific Palisades","1052 Swarthmore Avenue","Los Angeles","CA",34.04520,-118.52620),
 ("Aesop Platform","8850 Washington Boulevard","Culver City","CA",34.02650,-118.38940),
 ("Aesop Abbot Kinney","Abbot Kinney Boulevard","Venice","CA",33.99120,-118.46650),
 ("Aesop Santa Monica Place","Santa Monica Place","Santa Monica","CA",34.01300,-118.49560),
 ("Aesop Pasadena","Colorado Boulevard","Pasadena","CA",34.14560,-118.14950),
 ("Aesop Fillmore Street","Fillmore Street","San Francisco","CA",37.78560,-122.43360),
 ("Aesop Hayes Valley","550 Hayes Street","San Francisco","CA",37.77650,-122.42620),
 ("Aesop Berkeley","Fourth Street","Berkeley","CA",37.86940,-122.30010),
 ("Aesop Stanford","Stanford Shopping Center","Palo Alto","CA",37.44177,-122.17249),
 ("Aesop Fashion Valley","Fashion Valley","San Diego","CA",32.76847,-117.16583),
 ("Aesop UTC","Westfield UTC","San Diego","CA",32.87187,-117.21267),

 ("Aesop North Bridge","520 North Michigan Avenue","Chicago","IL",41.89210,-87.62450),
 ("Aesop Lincoln Park","West Armitage Avenue","Chicago","IL",41.91800,-87.65180),
 ("Aesop Bucktown","1653 North Damen Avenue","Chicago","IL",41.91230,-87.67720),

 ("Aesop Newbury Street","Newbury Street","Boston","MA",42.35150,-71.07660),
 ("Aesop Seaport","Seaport Boulevard","Boston","MA",42.35230,-71.04580),
 ("Aesop Harvard Square","Harvard Square","Cambridge","MA",42.37340,-71.11890),

 ("Aesop Georgetown","3275 M Street NW","Washington","DC",38.90500,-77.06480),
 ("Aesop Shaw","8th Street NW","Washington","DC",38.91690,-77.02340),

 ("Aesop NorthPark","NorthPark Center","Dallas","TX",32.86937,-96.77428),
 ("Aesop Knox","Knox Street","Dallas","TX",32.82150,-96.78930),
 ("Aesop Montrose","Westheimer Road","Houston","TX",29.74280,-95.39320),
 ("Aesop Heights Mercantile","Heights Mercantile","Houston","TX",29.77140,-95.39880),
 ("Aesop The Galleria","The Galleria","Houston","TX",29.73906,-95.46441),

 ("Aesop Aventura","Aventura Mall","Aventura","FL",25.95825,-80.14171),
 ("Aesop Design District","NE 41st Street","Miami","FL",25.81330,-80.19320),
 ("Aesop Brickell City Centre","701 South Miami Avenue","Miami","FL",25.76640,-80.19340),
 ("Aesop Wynwood","NW 2nd Avenue","Miami","FL",25.80080,-80.19930),

 ("Aesop Capitol Hill","11th Avenue","Seattle","WA",47.61420,-122.31780),
 ("Aesop Bellevue Square","Bellevue Square","Bellevue","WA",47.61633,-122.20420),
 ("Aesop NW 23rd Avenue","738 NW 23rd Avenue","Portland","OR",45.53100,-122.69790),
 ("Aesop Cherry Creek","Cherry Creek Shopping Center","Denver","CO",39.71744,-104.95492),
 ("Aesop Short Hills","The Mall at Short Hills","Short Hills","NJ",40.74010,-74.36499),
 ("Aesop Greenwich Avenue","200 Greenwich Avenue","Greenwich","CT",41.02620,-73.62630),
 ("Aesop Walnut Street","1701 Walnut Street","Philadelphia","PA",39.95000,-75.16900),
 ("Aesop Tysons Corner","Tysons Corner Center","McLean","VA",38.91673,-77.22321),
 ("Aesop Edgehill","Edgehill Avenue","Nashville","TN",36.14710,-86.79180),
 ("Aesop Ala Moana","Ala Moana Center","Honolulu","HI",21.29024,-157.84231),
]
out=[{"n":n,"a":a,"c":c,"s":s,"lat":lat,"lon":lon} for n,a,c,s,lat,lon in S]
names=[r["n"] for r in out]
assert len(names)==len(set(names)), "dupe"
json.dump(out,open('aesop_us.json','w'),indent=0)
print("aesop stores:",len(out))
from collections import Counter
print(Counter(r['s'] for r in out).most_common())
