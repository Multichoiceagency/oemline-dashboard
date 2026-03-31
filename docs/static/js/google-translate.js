function googleTranslateElementInit() {
  new google.translate.TranslateElement(
    {
      pageLanguage: 'en',
      includedLanguages:
        'en,nl,de,fr,es,it,pt,pl,cs,ro,hu,bg,hr,sk,sl,sr,uk,el,lt,lv,et,bs,tr,ru,ja,ko,zh-CN,zh-TW,ar',
      layout: google.translate.TranslateElement.InlineLayout.HORIZONTAL,
      autoDisplay: false,
    },
    'google_translate_element'
  );
}
