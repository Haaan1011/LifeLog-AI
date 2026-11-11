<script lang="ts">
export default {}
</script>

<style src="./theme.css"></style>

<style>
/* #ifdef H5 */
uni-page-body uni-button {
  margin-left: 0 !important;
  margin-right: 0 !important;
  line-height: 1.5 !important;
}
uni-page-body uni-button::after { border: 0 !important; }
uni-modal .uni-modal__bd { color: #4b6260; }
@media (min-width: 1000px) {
  uni-tabbar.uni-tabbar-bottom { display: none; }
  uni-page { --window-bottom: 0px; }
}
/* #endif */
</style>
