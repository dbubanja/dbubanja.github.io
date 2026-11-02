# Android APK преко PWABuilder-а

1. Прво отворите https://dbubanja.github.io/studio/ и провјерите офлајн рад након првог учитавања.
2. Отворите https://www.pwabuilder.com/ и унесите **пуну адресу са `/studio/`**. Сачекајте провјеру manifest-а и service worker-а.
3. Изаберите Android пакет. Назив: „Камата Студио“. Предложени package ID: `me.dbubanja.kamatastudio`. Почетна путања мора бити `/studio/`. За прво издање верзија може бити `2.0.0`, versionCode `1`.
4. Изаберите потписани пакет. PWABuilder може генерисати кључ за прво издање. Преузмите архиву и сачувајте **signing.keystore**, alias и лозинке у приватној резервној копији. Не објављујте кључ и лозинке у GitHub-у.
5. Из генерисаног пакета узмите исправан `assetlinks.json` са стварним package ID и SHA-256 отиском потписног сертификата. `assetlinks.template.json` у овом фолдеру је само шаблон и не смије бити објављен као готова веза.
6. Поставите `assetlinks.json` у **коријен домена**, овдје `dbubanja.github.io/.well-known/assetlinks.json`. Није довољно `studio/.well-known/assetlinks.json`. Ако већ постоје асоцијације друге апликације, додајте нову ставку у постојећи низ, не бришите претходне. У коријену репозиторијума треба да постоји `.nojekyll`.
7. Провјерите да адреса враћа JSON преко HTTPS-а, без пријављивања или преусмјерења. Неисправна асоцијација може оставити траку прегледача видљивом у Android апликацији.
8. Инсталирајте потписани APK на пробни Android. За дијељење ван Play Store-а Android може тражити дозволу за инсталацију из изабраног извора. Отворите апликацију онлајн, сачекајте припрему и испробајте у режиму авиона. TWA се ослања на компатибилан прегледач; APK сам по себи не значи да су сви веб ресурси већ преузети.
9. На GitHub-у отворите Releases → Draft a new release. Додајте APK са именом **`kamata-studio-v2.0.0.apk`**. Префикс је важан: бројач приказује само ове APK датотеке. Колегама шаљите линк до Release датотеке да би GitHub евидентирао преузимање.
10. За свако APK ажурирање задржите package ID и исти кључ, повећајте versionCode. Ако касније користите Play App Signing, провјерите отисак стварног app signing сертификата у Play Console-у; не мора бити исти као локални upload кључ.

Прије дијељења: провјерите почетну адресу, инсталацију, update преко претходне верзије, офлајн отварање, чување обрачуна, JSON пренос и Excel преузимање на физичком телефону.

Извори: [PWABuilder Android](https://github.com/pwa-builder/PWABuilder/blob/main/docs/builder/android.md), [TWA преглед](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities), [Digital Asset Links](https://developer.android.com/training/app-links/configure-assetlinks). Упутство провјерено 02.11.2026. Изворни пакет не садржи потписани APK нити потписни кључ.
