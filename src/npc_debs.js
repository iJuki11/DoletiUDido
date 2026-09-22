const TAU = Math.PI * 2;
const HEAD_URL = new URL('../assets/images/debs_head.png', import.meta.url).href;
const INK = '#3d4547';
const C = {
  silver: '#CECDBF', light: '#EEE9D8', shade: '#AAA99F', darkMetal: '#817F75',
  teal: '#448B89', tealLight: '#69AAA1', tealDark: '#2F666B',
  brass: '#D6A057', brassLight: '#E7C58A',
  shirt: '#303436', shirtLight: '#45484A', shirtDark: '#22282B',
  skin: '#E5AD87', skinShade: '#C88869', skinLight: '#F3C29A',
  amber: '#EFA52B', amberDark: '#C57D27', yellow: '#FFDA61', core: '#FFF2AD',
};
const sharedHeads = new Map();
let surfaces = new WeakMap();
let sharedGlow = null;
const wrap = phase => ((phase % TAU) + TAU) % TAU;

function loadHead(url) {
  if (!sharedHeads.has(url)) {
    sharedHeads.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Nije moguće učitati PNG glavu: ${url}`));
      image.src = url;
    }).catch(error => { sharedHeads.delete(url); throw error; }));
  }
  return sharedHeads.get(url);
}
function surface(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; return canvas;
  }
  return null;
}

// Coordinates trace the reference's three-quarter view; strokes and flat fills
// use the same palette/line language as EnemyTruck. Only the head is a bitmap.
function paintArtwork(ctx, head) {
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const shape = (color, d, stroke = true) => {
    const path = new Path2D(d); ctx.fillStyle = color; ctx.fill(path); if (stroke) ctx.stroke(path);
  };
  const line = (d, color = INK, width = 4) => {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(new Path2D(d)); ctx.restore();
  };
  const oval = (x,y,rx,ry,color,angle=0,stroke=true) => {
    ctx.beginPath(); ctx.ellipse(x,y,rx,ry,angle,0,TAU); ctx.fillStyle=color;ctx.fill();if(stroke)ctx.stroke();
  };
  const rivet = (x,y,r=6) => {
    oval(x,y,r,r+1,C.brassLight); oval(x-1.2,y-2,r*.3,r*.26,C.light,0,false);
  };

  // Rear engine housings, the far cockpit rim and leather seat.
  oval(204,650,50,80,C.teal,-.6);
  shape(C.tealLight,'M 155 646 Q 166 592 218 580 L 235 591 Q 185 603 178 649 Z',false);
  oval(1163,789,53,91,C.teal,-.31);
  oval(1196,795,27,49,C.brass,-.2);
  oval(1196,795,19,37,C.amber,-.2);
  oval(667,738,449,120,C.brassLight,.135);
  oval(673,729,430,102,C.shirtDark,.135);
  shape(C.brass,'M 241 641 Q 244 473 290 402 Q 321 355 400 367 L 502 595 L 322 688 Z');
  shape('#815940','M 257 632 Q 261 462 308 407 Q 337 378 393 383 L 487 597 L 319 664 Z');
  shape('#A87651','M 277 465 Q 283 400 339 393 L 389 394 L 399 408 Q 312 396 287 489 Z',false);
  line('M 271 475 L 262 580',C.brassLight,5);
  rivet(274,486); rivet(267,569);

  // Hood and stocky torso, keeping both arms forward as in the source image.
  shape(C.shirt,'M 289 669 Q 277 602 304 517 Q 329 432 402 384 L 404 359 Q 395 338 425 312 Q 453 287 490 299 L 743 379 Q 803 377 850 395 Q 923 403 947 460 Q 990 511 1019 582 L 1049 671 Q 979 722 891 721 L 393 692 Z');
  shape(C.shirtLight,'M 410 365 Q 411 316 456 311 L 530 338 L 492 376 Q 455 354 410 365 Z',false);
  shape(C.shirtDark,'M 424 381 Q 504 350 567 405 L 696 461 L 796 433 L 863 470 L 821 566 L 757 644 L 647 647 Q 605 522 538 470 Z',false);
  line('M 419 365 Q 480 359 528 392',INK,5);
  shape(C.shirtLight,'M 793 435 Q 848 407 890 443 L 916 487 L 866 467 L 865 588 L 834 634 L 814 541 Z',false);
  line('M 782 463 Q 799 524 819 573 L 846 641',C.shirtDark,7);
  line('M 789 463 Q 808 527 825 571',C.shirtLight,3);
  line('M 552 427 L 575 505 M 760 470 L 778 529',C.shirtDark,7);
  oval(575,507,5,9,C.shirtLight); oval(778,531,5,9,C.shirtLight);

  // Left shoulder/sleeve with broad, simplified fold shapes.
  shape(C.shirt,'M 417 386 Q 363 392 322 469 Q 283 543 289 635 Q 292 661 327 671 L 548 681 L 599 641 L 588 562 Q 550 548 520 564 L 466 579 Q 512 472 469 418 Z');
  shape(C.shirtLight,'M 340 461 Q 374 409 417 407 Q 452 414 461 439 Q 403 424 371 478 Z',false);
  shape(C.shirtDark,'M 294 604 Q 361 563 432 573 L 488 586 L 501 659 L 345 663 Q 307 657 294 643 Z',false);
  line('M 333 490 Q 382 458 444 477 M 316 525 Q 361 494 419 509 M 307 562 Q 361 535 412 548',C.shirtLight,7);
  line('M 371 636 Q 434 587 513 584 M 397 653 Q 447 615 513 610',C.shirtLight,5);
  shape(C.shirtLight,'M 527 559 L 554 553 Q 583 555 594 579 L 592 644 L 564 666 L 533 661 Q 519 613 527 559 Z');
  for(let x=532;x<=551;x+=7) line(`M ${x} 567 Q ${x-8} 613 ${x+8} 655`,C.shirtDark,2.5);

  // Right arm and cuff.
  shape(C.shirt,'M 882 451 Q 930 451 966 511 L 1016 582 L 1001 644 L 955 656 L 925 620 Q 910 555 874 529 Z');
  shape(C.shirtLight,'M 905 472 Q 935 472 955 516 L 981 549 Q 937 535 917 511 Z',false);
  line('M 921 548 Q 948 537 978 552 M 935 574 Q 956 563 986 576 M 944 601 L 980 610',C.shirtDark,6);
  shape(C.shirtDark,'M 968 578 L 993 564 L 1028 601 L 1013 665 L 979 672 L 960 638 Z');

  // Control sticks and palms, behind the front cockpit/windscreen.
  line('M 627 684 L 677 548',INK,22); line('M 627 681 L 677 548',C.silver,12);
  line('M 1054 740 L 1031 584',INK,20); line('M 1054 737 L 1031 584',C.silver,11);
  oval(686,542,34,25,C.teal,.22); oval(676,534,16,8,C.tealLight,.2,false);
  oval(1033,571,33,23,C.teal,.15); oval(1023,563,13,7,C.tealLight,.2,false);
  shape(C.skin,'M 568 627 Q 572 593 595 566 Q 616 534 646 538 Q 673 541 695 561 Q 705 577 694 590 Q 718 587 732 594 Q 742 609 727 625 L 710 629 Q 714 650 693 657 Q 692 675 668 678 L 615 675 Q 575 680 568 649 Z');
  shape(C.skinShade,'M 569 634 Q 578 659 616 662 L 674 663 Q 694 659 700 648 Q 698 674 668 678 L 615 675 Q 574 678 568 649 Z',false);
  line('M 632 564 Q 669 565 694 587 M 624 591 Q 663 591 695 610 M 621 618 Q 661 618 690 634',C.skinShade,4);
  line('M 612 550 Q 633 541 650 549',C.skinLight,6);
  shape(C.skin,'M 986 582 Q 1004 575 1010 596 Q 1036 583 1061 587 Q 1086 590 1090 616 L 1103 654 Q 1111 684 1092 704 Q 1071 720 1038 700 Q 1011 690 1009 661 L 987 629 Q 971 614 986 582 Z');
  shape(C.skinShade,'M 1021 667 Q 1061 689 1102 668 Q 1108 691 1090 704 Q 1069 717 1038 700 Z',false);
  line('M 1017 617 Q 1054 629 1088 613 M 1024 640 Q 1065 652 1097 635 M 1031 664 Q 1069 674 1100 657',C.skinShade,4);
  line('M 991 590 Q 1007 594 1003 615 Q 997 623 986 618',C.skinShade,3);

  // Separate head PNG, its bottom naturally overlapping the dark hoodie.
  if (head) ctx.drawImage(head, 471, 57, 412, 412 * head.height / head.width);

  // Windscreen: cool flat tones with two broad highlights.
  shape('#334C57','M 663 681 L 686 632 Q 829 611 944 648 Q 983 661 1005 708 L 1027 771 L 777 747 Z');
  shape('#79A4AA','M 850 633 L 884 637 L 923 753 L 889 750 Z',false);
  shape('#BFD2CC','M 891 640 L 903 642 L 942 757 L 929 754 Z',false);
  shape(C.tealDark,'M 666 676 Q 839 685 1005 717 L 1026 769 L 762 735 Z',false);
  line('M 686 632 Q 829 611 944 648 Q 983 661 1005 708 L 1027 771',C.light,6);

  // Main hull. All shading is made from flat closed shapes, without filters.
  shape(C.silver,'M 245 641 Q 183 656 119 713 Q 50 774 80 883 Q 131 1033 399 1108 Q 664 1220 980 1123 Q 1190 1064 1233 964 Q 1237 893 1175 828 L 1113 767 Q 1072 808 854 771 L 430 704 Q 303 682 245 641 Z');
  shape(C.light,'M 216 672 Q 177 691 143 728 Q 196 713 251 704 L 376 739 Q 604 812 866 829 L 1139 863 L 1110 816 Q 1031 825 850 790 L 432 721 Q 298 698 246 664 Z',false);
  shape(C.shade,'M 103 894 Q 206 981 432 1018 Q 679 1074 954 1075 Q 1129 1058 1213 1001 Q 1150 1113 944 1152 Q 676 1214 398 1108 Q 163 1045 103 894 Z',false);
  shape(C.darkMetal,'M 252 1027 Q 367 1087 477 1109 Q 706 1171 954 1126 Q 1080 1104 1160 1055 Q 1101 1115 980 1145 Q 699 1230 399 1108 Q 295 1077 252 1027 Z',false);
  line('M 263 1050 Q 602 1211 956 1143',C.brass,5);
  // Panel seams stop at the horizontal belt.
  line('M 244 691 Q 181 743 177 827 M 323 738 Q 277 779 255 858 M 584 788 L 552 918 M 957 842 L 1016 976 M 1137 876 L 1169 999',INK,4);
  line('M 473 1015 L 493 1089 M 878 1062 L 894 1144 M 1015 1032 L 1001 1118',INK,4);
  line('M 593 795 L 563 918 M 965 851 L 1026 976',C.light,3);

  // Teal belt wraps around the entire saucer.
  shape(C.teal,'M 159 831 Q 430 926 801 962 Q 1082 1005 1227 963 L 1217 1006 Q 1062 1070 786 1015 Q 404 979 151 887 Z');
  shape(C.tealLight,'M 164 836 Q 430 930 801 968 Q 1082 1010 1225 970 L 1220 983 Q 1049 1019 800 981 Q 427 944 161 850 Z',false);
  shape(C.tealDark,'M 155 871 Q 444 974 790 1002 Q 1065 1054 1220 995 L 1217 1006 Q 1062 1070 786 1015 Q 404 979 151 887 Z',false);
  line('M 164 899 Q 485 1006 793 1030 Q 1068 1081 1210 1022',C.light,8);
  line('M 551 925 L 542 991 M 1016 988 L 1008 1038',INK,4);

  // Cockpit front lip masks the lower arms and glass like the reference.
  shape(C.brassLight,'M 244 625 Q 242 658 308 677 Q 474 727 720 756 L 963 797 Q 1091 816 1114 770 L 1128 789 Q 1110 840 961 814 L 714 775 Q 461 748 301 697 Q 239 678 235 650 Z');
  shape(C.shade,'M 238 650 Q 264 685 317 696 Q 493 748 721 772 L 962 812 Q 1081 833 1127 791 L 1120 814 Q 1085 845 957 829 L 715 790 Q 464 760 308 710 Q 244 690 237 666 Z');
  line('M 253 636 Q 267 662 320 676 Q 484 724 721 750 L 972 792 Q 1086 810 1104 779',C.light,5);
  [[273,653],[312,687],[399,711],[540,745],[627,759],[748,778],[858,794],[983,816],[1052,806]].forEach(p=>rivet(...p));
  [[209,816],[294,735],[382,805],[527,875],[596,889],[753,835],[973,937],[1051,956],[1134,839]].forEach(p=>rivet(...p,6));

  // Large left thruster pod, light bezels and three underside engines.
  oval(94,843,79,132,C.brass,-.22);
  oval(99,829,65,122,C.teal,-.22);
  shape(C.tealLight,'M 61 721 Q 106 694 142 747 L 155 803 Q 116 744 75 747 Z',false);
  oval(63,839,51,111,C.silver,-.15);
  oval(34,839,26,64,C.brass,-.05);
  oval(34,839,19,51,C.amber,-.05);
  line('M 91 726 Q 141 763 153 856 Q 158 913 140 947',C.light,5);
  const bezel=(x,y,rx,ry,a=0)=>{
    oval(x,y,rx+12,ry+12,C.teal,a);oval(x,y,rx+4,ry+4,C.silver,a);
    oval(x,y,rx,ry,C.brass,a);oval(x,y,rx-8,ry-8,C.amber,a);
  };
  bezel(345,860,43,50,.3); bezel(810,925,55,54,.12); bezel(1136,964,32,47,.25);
  oval(382,1067,90,35,C.teal,.3); oval(382,1081,70,24,C.brass,.3); oval(382,1081,60,17,C.amber,.3);
  oval(650,1131,195,52,C.teal,.08); oval(650,1153,165,35,C.brass,.08); oval(650,1153,147,25,C.amber,.08);
  oval(949,1141,86,31,C.teal,-.3); oval(949,1155,64,21,C.brass,-.3); oval(949,1155,54,14,C.amber,-.3);
  line('M 519 1105 Q 650 1085 771 1123',C.tealLight,6);
  ctx.restore();
}

// These lamps stay physically fixed. A hot core and warm halo chase around them.
const LAMPS = [
  [34,839,17,47,-.05,0], [345,860,33,40,.3,.8],
  [810,925,45,44,.12,1.6], [1136,964,22,37,.25,2.4],
  [1196,795,17,34,-.2,3.2],
];
function paintGlow(ctx, rx, ry, opacity) {
  // One small reusable radial texture; no per-frame blur or shadow filter.
  if (!sharedGlow) {
    const canvas = surface(160,160);
    if (canvas) {
      const c = canvas.getContext('2d');
      const gradient = c.createRadialGradient(80,80,0,80,80,80);
      gradient.addColorStop(0,'rgba(255,244,163,0.94)');
      gradient.addColorStop(.30,'rgba(255,202,53,0.80)');
      gradient.addColorStop(.51,'rgba(255,168,19,0.48)');
      gradient.addColorStop(.74,'rgba(255,139,0,0.20)');
      gradient.addColorStop(1,'rgba(255,139,0,0)');
      c.fillStyle=gradient;c.fillRect(0,0,160,160);sharedGlow=canvas;
    }
  }
  ctx.save();ctx.globalAlpha*=opacity;
  if(sharedGlow)ctx.drawImage(sharedGlow,-rx*2,-ry*1.75,rx*4,ry*3.5);
  else {
    ctx.globalAlpha*=.22;ctx.fillStyle='#FFB125';ctx.beginPath();
    ctx.ellipse(0,0,rx*1.5,ry*1.4,0,0,TAU);ctx.fill();
  }
  ctx.restore();
}
function paintLights(ctx, phase, floatPhase, strength) {
  ctx.save();
  const baseAlpha = ctx.globalAlpha;
  for(const [x,y,rx,ry,angle,offset] of LAMPS) {
    const pulse = Math.pow((1+Math.cos(phase-offset))/2,3);
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);
    paintGlow(ctx,rx,ry,strength*(.28+.72*pulse));
    ctx.globalAlpha = baseAlpha*strength*(.58+.42*pulse);
    ctx.fillStyle=C.yellow;ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,0,TAU);ctx.fill();
    ctx.globalAlpha = baseAlpha*strength*(.54+.46*pulse);
    ctx.fillStyle=C.core;ctx.beginPath();ctx.ellipse(-rx*.06,-ry*.06,rx*.64,ry*.72,0,0,TAU);ctx.fill();
    ctx.globalAlpha=baseAlpha*strength*(.28+.72*pulse);
    ctx.fillStyle='#FFFFEB';ctx.beginPath();ctx.ellipse(-rx*.06,-ry*.06,rx*.40,ry*.51,0,0,TAU);ctx.fill();
    ctx.globalAlpha=baseAlpha*strength;ctx.fillStyle='#FFFFF1';ctx.beginPath();ctx.ellipse(-rx*.3,-ry*.5,rx*.16,ry*.12,0,0,TAU);ctx.fill();
    ctx.restore();
  }
  const engine=.73+.26*Math.sin(floatPhase*2+.5);
  for(const [x,y,rx,ry,a] of [[382,1081,57,15,.3],[650,1153,145,24,.08],[949,1155,51,12,-.3]]) {
    ctx.save();ctx.translate(x,y);ctx.rotate(a);
    paintGlow(ctx,rx,ry*1.18,engine*strength*.88);
    ctx.globalAlpha*=engine*strength;
    ctx.fillStyle=C.yellow;ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,0,TAU);ctx.fill();
    ctx.fillStyle=C.core;ctx.beginPath();ctx.ellipse(0,0,rx*.78,ry*.72,0,0,TAU);ctx.fill();
    ctx.fillStyle='#FFFFE6';ctx.beginPath();ctx.ellipse(0,0,rx*.53,ry*.43,0,0,TAU);ctx.fill();ctx.restore();
  }
  ctx.restore();
}

/**
 * NPCDebs — floating character with pre-rendered bitmap art, a separately
 * loaded PNG head (debs_head.png), and a soft bobbing motion. Renamed
 * from `EnemyUfo` to fit the NPC family naming (NPCPrsan, NPCNidjo,
 * NPCToni, NPCKonobari, NPCDebs, ...) used by NPCManager sub-managers.
 *
 * x/y = centre of hull. deltaTime in seconds. velocityX: pixels/second.
 * direction: +1 reference orientation; -1 mirrors the entire character.
 */
export class NPCDebs {
  constructor(x,y,{
    scale=0.65,direction=1,velocityX=0,headUrl=HEAD_URL,
    floatSpeed=.25,bobAmount=9,swayAmount=.025,lightSpeed=.5,
    lightIntensity=1,cacheResolution=1,
  }={}) {
    this.x=x;this.y=y;this.scale=scale;this.direction=direction<0?-1:1;this.velocityX=velocityX;
    this.rotation=0;this.time=0;this.floatPhase=0;this.lightPhase=0;
    this.floatSpeed=floatSpeed;this.bobAmount=bobAmount;this.swayAmount=swayAmount;
    this.lightSpeed=lightSpeed;this.lightIntensity=lightIntensity;
    this.cacheResolution=Math.max(.25,Math.min(2,cacheResolution));
    this.head=null;this.loadError=null;this._artwork=null;
    this.ready=loadHead(headUrl).then(head=>{
      this.head=head;
      let variants=surfaces.get(head);if(!variants){variants=new Map();surfaces.set(head,variants);}
      if(!variants.has(this.cacheResolution)){
        const size=Math.round(1254*this.cacheResolution),canvas=surface(size,size);
        if(canvas){const c=canvas.getContext('2d');c.scale(size/1254,size/1254);paintArtwork(c,head);variants.set(this.cacheResolution,canvas);}
      }
      this._artwork=variants.get(this.cacheResolution)||null;
      return true;
    },error=>{this.loadError=error;return false;});
  }
  static preload(options={}) { return new NPCDebs(0,0,options).ready; }
  static clearCache() { sharedHeads.clear();surfaces=new WeakMap();sharedGlow=null; }
  update(dt) {
    if(!Number.isFinite(dt)||dt<=0)return;
    this.time+=dt;this.x+=this.velocityX*dt;
    this.floatPhase=wrap(this.floatPhase+dt*TAU*this.floatSpeed);
    this.lightPhase=wrap(this.lightPhase+dt*TAU*this.lightSpeed);
  }
  getPose() {
    return {y:this.y+Math.sin(this.floatPhase)*this.bobAmount*this.scale,
      angle:this.rotation+Math.sin(this.floatPhase)*this.swayAmount};
  }
  _bounds(l,t,r,b) {
    const pose=this.getPose(),c=Math.cos(pose.angle),s=Math.sin(pose.angle);
    const cx=(l+r)/2*this.scale*this.direction,cy=(t+b)/2*this.scale;
    const hw=(r-l)/2*Math.abs(this.scale),hh=(b-t)/2*Math.abs(this.scale);
    const ex=Math.abs(c)*hw+Math.abs(s)*hh,ey=Math.abs(s)*hw+Math.abs(c)*hh;
    const x=this.x+cx*c-cy*s,y=pose.y+cx*s+cy*c;
    return {left:x-ex,right:x+ex,top:y-ey,bottom:y+ey};
  }
  getBounds() { return this._bounds(-285,-348,285,172); }
  getVisualBounds() { return this._bounds(-334,-400,334,212); }
  draw(ctx,viewport=null) {
    if(!this.head)return;
    if(viewport){const b=this.getVisualBounds();if(b.right<viewport.left||b.left>viewport.right||b.bottom<viewport.top||b.top>viewport.bottom)return;}
    const pose=this.getPose();ctx.save();ctx.translate(this.x,pose.y);ctx.rotate(pose.angle);
    ctx.scale(this.scale*this.direction*.5,this.scale*.5);ctx.translate(-627,-830);
    if(this._artwork)ctx.drawImage(this._artwork,0,0,1254,1254);else paintArtwork(ctx,this.head);
    paintLights(ctx,this.lightPhase,this.floatPhase,Math.max(0,Math.min(1,this.lightIntensity)));
    ctx.restore();
  }
}
export default NPCDebs;
