// If visitor is using msIE, show alert

//userAgent in IE7 WinXP returns: Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1; .NET CLR 2.0.50727)
//userAgent in IE11 Win7 returns: Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko

if (navigator.userAgent.indexOf('MSIE') != -1)
 var detectIEregexp = /MSIE (\d+\.\d+);/ //test for MSIE x.x
else // if no "MSIE" string in userAgent
 var detectIEregexp = /Trident.*rv[ :]*(\d+\.\d+)/ //test for rv:x.x or rv x.x where Trident string exists

if (detectIEregexp.test(navigator.userAgent)){ //if some form of IE
 var ieversion=new Number(RegExp.$1) // capture x.x portion and store as a number
 if (ieversion>=12)
  alert("Wow that's a bummer! I see you're using IE12 or above. I know it's not the best practice, but I really don't have time to make  my site pretty in Internet Explorer. If you still want to use IE and want to get in contact with me, just search for @_SimplePotato on Twitter and DM me.")
 else if (ieversion>=11)
  alert("Wow that's a bummer! I see you're using IE11 or above. I know it's not the best practice, but I really don't have time to make  my site pretty in Internet Explorer. If you still want to use IE and want to get in contact with me, just search for @_SimplePotato on Twitter and DM me.")
 else if (ieversion>=10)
  alert("Wow that's a bummer! I see you're still using IE10 or above. I know it's not the best practice, but I really don't have time to make  my site pretty in Internet Explorer. If you still want to use IE and want to get in contact with me, just search for @_SimplePotato on Twitter and DM me.")
 else if (ieversion>=9)
  alert("Wow that's a bummer! I see you're still using IE9 or above. I know it's not the best practice, but I really don't have time to make  my site pretty in Internet Explorer. If you still want to use IE and want to get in contact with me, just search for @_SimplePotato on Twitter and DM me.")
 else if (ieversion>=8)
  alert("Wow that's a bummer! I see you're still using IE8 or above. I know it's not the best practice, but I really don't have time to make  my site pretty in Internet Explorer. If you still want to use IE and want to get in contact with me, just search for @_SimplePotato on Twitter and DM me.")
 else if (ieversion>=7)
  alert("Wow that's a bummer! I see you're still using IE7.x. I know it's not the best practice, but I really don't have time to make  my site pretty in Internet Explorer. If you still want to use IE and want to get in contact with me, just search for @_SimplePotato on Twitter and DM me.")
 else if (ieversion>=6)
  alert("OMG! I see you're still using IE6.x. I know it's not the best practice, but I really don't have time to make  my site pretty in Internet Explorer. If you still want to use IE and want to get in contact with me, just search for @_SimplePotato on Twitter and DM me.")
 else if (ieversion>=5)
  alert("OMG! I see you're still using IE5.x. I know it's not the best practice, but i really don't have time to make  my site pretty in Internet Explorer. If you still want to use IE and want to get in contact with me, just search for @_SimplePotato on Twitter and DM me.")
  
// PopUp window with a question if they want to go to twitter
if (window.confirm("Would you like to go to Twitter and search for @_SimplePotato ?")) {
  window.location.href = "https://www.twitter.com"
}

}
else{
  document.write("I like your browser. It's OK")
}

