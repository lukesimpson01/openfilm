export const FONT_CHOICES=[
  ['Inter','inter','Everyday'],['Sora','sora','Everyday'],['Manrope','manrope','Everyday'],['DM Sans','dmsans','Everyday'],['Roboto','roboto','Everyday'],['Lora','lora','Editorial'],['Playfair Display','playfairdisplay','Editorial'],['Source Serif 4','sourceserif4','Editorial'],
  ['Montserrat','montserrat','Vlog'],['Poppins','poppins','Vlog'],['Bebas Neue','bebasneue','Vlog'],['Anton','anton','Vlog'],['Oswald','oswald','Vlog'],['Archivo Black','archivoblack','Vlog'],['Outfit','outfit','Vlog'],['League Spartan','leaguespartan','Vlog'],
  ['Rajdhani','rajdhani','Tactical'],['Barlow Condensed','barlowcondensed','Tactical'],['Teko','teko','Tactical'],['Orbitron','orbitron','Tactical'],['Share Tech Mono','sharetechmono','Tactical'],['Space Grotesk','spacegrotesk','Tactical'],['Caveat','caveat','Expressive'],['Pacifico','pacifico','Expressive']
].map(([name,id,group])=>({name,id,group}));
export const fontChoice=name=>FONT_CHOICES.find(f=>f.name===name);
