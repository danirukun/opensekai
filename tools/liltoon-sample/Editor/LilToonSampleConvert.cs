using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using lilToon;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// The avatar that a batch run converts, from the command line:
/// -avatar &lt;folder under Assets that holds one .vrm&gt; (default Catboy),
/// -preset catboy|none (default catboy for the Catboy, else none).
/// The catboy preset adds the slice features by material name and uses the fixed reference rig.
/// The none preset maps each MToon value only and frames the camera on the head bone.
/// </summary>
public sealed class LilToonSampleProfile
{
    public const string DefaultAvatar = "Catboy";

    public string Avatar { get; private set; }
    public bool CatboyPreset { get; private set; }

    public string Folder => $"Assets/{Avatar}";
    public string MaterialFolder => $"{Folder}/lilToon";
    public string ScenePath => $"{Folder}/Sample.unity";
    public string RootName => $"{Avatar}-lilToon";
    public string ExportFileName => $"{Avatar}-lilToon.vrm";
    public string ExportDirectory => Path.Combine(Path.GetDirectoryName(Application.dataPath), "Export", Avatar);
    public string Preset => CatboyPreset ? "catboy" : "none";

    public string SourceAssetPath
    {
        get
        {
            var full = Path.Combine(Path.GetDirectoryName(Application.dataPath), Folder);
            var files = Directory.Exists(full) ? Directory.GetFiles(full, "*.vrm", SearchOption.TopDirectoryOnly) : new string[0];
            if (files.Length != 1) throw new InvalidOperationException($"{Folder} must hold exactly one .vrm file; it holds {files.Length}.");
            return $"{Folder}/{Path.GetFileName(files[0])}";
        }
    }

    public static LilToonSampleProfile FromCommandLine()
    {
        var args = Environment.GetCommandLineArgs();
        string Arg(string name)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }
        var avatar = Arg("-avatar") ?? DefaultAvatar;
        var preset = Arg("-preset") ?? (avatar == DefaultAvatar ? "catboy" : "none");
        if (preset != "catboy" && preset != "none") throw new ArgumentException($"-preset must be catboy or none, not {preset}.");
        return new LilToonSampleProfile { Avatar = avatar, CatboyPreset = preset == "catboy" };
    }
}

/// <summary>
/// Makes the lilToon sample scene from an imported MToon VRM.
/// Each MToon material gets a lilToon copy. With the catboy preset, named materials get the extra slice features.
/// Run from the menu or with: Unity -batchmode -quit -projectPath ... -executeMethod LilToonSampleConvert.Run [-avatar Name] [-preset catboy|none]
/// </summary>
public static class LilToonSampleConvert
{
    public const string LightName = "Reference Light";
    public const string CameraName = "Reference Camera";

    // Reference scene values. Task 10 uses the same values.
    // Forward (0.3214, -0.7660, -0.5567): the light comes from above and in front of the +Z-facing avatar.
    public static readonly Vector3 LightRotation = new Vector3(50f, 150f, 0f);
    public const float LightIntensity = 1f;
    public static readonly Color AmbientColor = new Color(0.2f, 0.2f, 0.2f, 1f);
    // The fixed rig of the catboy preset.
    public static readonly Vector3 CameraPosition = new Vector3(0f, 1.3f, 1.6f);
    public static readonly Vector3 CameraTarget = new Vector3(0f, 1.3f, 0f);
    public const float CameraFieldOfView = 35f;
    public static readonly Color CameraBackground = new Color(0.3f, 0.3f, 0.3f, 1f);
    // The head-framed rig of the none preset: the camera looks at this distance below the head bone.
    public const float HeadFrameDrop = 0.15f;

    // Catboy preset: MToon cutout materials whose main texture has no alpha below 1. They become opaque so that
    // the export keeps the opaque and the opaque+outline variants next to the cutout ones.
    private static readonly HashSet<string> OpaqueByName = new HashSet<string>
    {
        "N00_000_00_EyeWhite_00_EYE",
        "Accessory_GlassesHiFrame_01_MATCAP",
        "Accessory_CatEar_01_CLOTH",
        "N00_004_01_Shoes_01_CLOTH",
    };

    [MenuItem("OpenSekai/Convert avatar to lilToon")]
    public static void Run()
    {
        try
        {
            Convert(LilToonSampleProfile.FromCommandLine());
        }
        catch (Exception e)
        {
            Debug.LogError($"LilToonSampleConvert failed: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            throw;
        }
    }

    internal static GameObject LoadSourcePrefab(LilToonSampleProfile profile)
    {
        var source = profile.SourceAssetPath;
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(source);
        if (prefab == null)
        {
            // On the first project open the VRM can import before the MToon10 shader exists. Import it again.
            AssetDatabase.ImportAsset(source, ImportAssetOptions.ForceUpdate | ImportAssetOptions.ForceSynchronousImport);
            prefab = AssetDatabase.LoadAssetAtPath<GameObject>(source);
        }
        if (prefab == null) throw new InvalidOperationException($"No imported prefab at {source}. Check the VRM import log.");
        return prefab;
    }

    private static void Convert(LilToonSampleProfile profile)
    {
        var prefab = LoadSourcePrefab(profile);
        Debug.Log($"LilToonSampleConvert: avatar {profile.Avatar}, preset {profile.Preset}, source {profile.SourceAssetPath}");

        // The mapping reads MToon properties only. Another shader would convert with default values and a wrong look.
        var other = prefab.GetComponentsInChildren<Renderer>(true)
            .SelectMany(r => r.sharedMaterials)
            .Where(m => m != null && !m.shader.name.Contains("MToon"))
            .Select(m => $"{m.name} ({m.shader.name})")
            .Distinct()
            .ToList();
        if (other.Count > 0) throw new InvalidOperationException($"Materials with a shader other than MToon:\n{string.Join("\n", other)}");

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var root = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
        PrefabUtility.UnpackPrefabInstance(root, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
        root.name = profile.RootName;
        root.transform.position = Vector3.zero;
        root.transform.rotation = Quaternion.identity;

        EnsureFolder(profile.MaterialFolder);
        var converted = new Dictionary<Material, Material>();
        var lines = new List<string>();
        foreach (var renderer in root.GetComponentsInChildren<Renderer>(true))
        {
            var materials = renderer.sharedMaterials;
            for (var i = 0; i < materials.Length; i++)
            {
                var source = materials[i];
                if (source == null) continue;
                if (!converted.TryGetValue(source, out var target))
                {
                    target = MakeLilToonMaterial(source, profile, lines);
                    converted[source] = target;
                }
                materials[i] = target;
            }
            renderer.sharedMaterials = materials;
        }

        AddReferenceLightAndCamera(ReferenceRig(root, profile), profile);
        AssetDatabase.SaveAssets();
        EditorSceneManager.SaveScene(scene, profile.ScenePath);

        var table = string.Join("\n", lines);
        Debug.Log($"LilToonSampleConvert: converted {converted.Count} materials.\n{table}");
        Directory.CreateDirectory(profile.ExportDirectory);
        File.WriteAllText(Path.Combine(profile.ExportDirectory, "material-map.txt"), table + "\n", new UTF8Encoding(false));
    }

    private static void EnsureFolder(string folder)
    {
        if (AssetDatabase.IsValidFolder(folder)) return;
        var parent = Path.GetDirectoryName(folder).Replace('\\', '/');
        EnsureFolder(parent);
        AssetDatabase.CreateFolder(parent, Path.GetFileName(folder));
    }

    // One source MToon material (VRM10/MToon10 after migration, or VRM/MToon) to one lilToon material asset.
    private static Material MakeLilToonMaterial(Material source, LilToonSampleProfile profile, List<string> lines)
    {
        var values = ReadMToon(source);
        var features = new List<string>();

        var mode = values.AlphaMode == 2 ? RenderingMode.Transparent
            : values.AlphaMode == 1 ? RenderingMode.Cutout
            : RenderingMode.Opaque;
        if (profile.CatboyPreset && mode == RenderingMode.Cutout && OpaqueByName.Contains(source.name))
        {
            // These textures have no alpha below 1, so the opaque variant renders the same.
            // The sample keeps them opaque so that the opaque variants are in the export.
            mode = RenderingMode.Opaque;
            features.Add("cutout->opaque(by name)");
        }

        var material = new Material(Shader.Find("lilToon")) { name = source.name };
        lilToonInspector.SetupMaterialWithRenderingMode(material, mode, TransparentMode.Normal, values.OutlineOn, false, false, false);
        var expectedShader = ExpectedShaderName(mode, values.OutlineOn);
        if (material.shader == null || material.shader.name != expectedShader)
        {
            var shader = Shader.Find(expectedShader);
            if (shader == null) throw new InvalidOperationException($"Shader {expectedShader} was not found. Is lilToon installed?");
            material.shader = shader;
        }

        // Main color and texture.
        material.SetColor("_Color", values.Color);
        material.SetTexture("_MainTex", values.MainTex);
        material.SetTextureScale("_MainTex", values.MainScale);
        material.SetTextureOffset("_MainTex", values.MainOffset);
        material.SetFloat("_Cutoff", values.Cutoff);
        material.SetInt("_Cull", values.Cull);
        if (mode == RenderingMode.Transparent) features.Add("transparent");
        if (mode == RenderingMode.Cutout) features.Add("cutout");

        // First shadow band from the MToon shade.
        material.SetInt("_UseShadow", 1);
        material.SetColor("_ShadowColor", values.ShadeColor);
        material.SetFloat("_ShadowBorder", values.ShadowBorder);
        material.SetFloat("_ShadowBlur", values.ShadowBlur);
        material.SetFloat("_ShadowStrength", 1f);
        if (values.ShadeTex != null && values.ShadeTex != values.MainTex)
        {
            material.SetTexture("_ShadowColorTex", values.ShadeTex);
            features.Add("shadowColorTex");
        }
        // lilToon turns the second band on by default. Only the named materials of the catboy preset keep it.
        material.SetColor("_Shadow2ndColor", new Color(0f, 0f, 0f, 0f));
        material.SetColor("_Shadow3rdColor", new Color(0f, 0f, 0f, 0f));
        features.Add("shadow1");
        // Four lilToon defaults that differ from MToon. The catboy preset keeps them, as in the recorded test avatar.
        if (!profile.CatboyPreset)
        {
            // MToon has no shadow border gradient. lilToon's default border color (1, 0.1, 0) pulls the red channel of
            // the shadow toward the lit color near each shadow edge, so a dark shade shows red edges. Black turns it off.
            material.SetColor("_ShadowBorderColor", Color.black);
            // MToon adds albedo x ambient to the shade. lilToon adds it only with this strength, so a black shade stays black.
            material.SetFloat("_ShadowEnvStrength", 1f);
            // MToon has no shadow anti-aliasing. lilToon widens the border by the screen derivative, which puts thin
            // and curved parts (eyelashes, the nose tip) into the shade.
            material.SetFloat("_AAStrength", 0f);
            // MToon turns the normal of a back face toward the camera. lilToon does that only with this flag, so the
            // inner side of a double-sided part (a jacket lining) shades as if it faced away from the light.
            material.SetFloat("_FlipNormal", 1f);
        }

        if (!IsPlaceholder(values.BumpMap))
        {
            material.SetInt("_UseBumpMap", 1);
            material.SetTexture("_BumpMap", values.BumpMap);
            material.SetFloat("_BumpScale", values.BumpScale);
            features.Add("normalMap");
        }

        if (values.RimColor.maxColorComponent > 0f)
        {
            material.SetInt("_UseRim", 1);
            material.SetColor("_RimColor", values.RimColor);
            material.SetFloat("_RimFresnelPower", values.RimFresnelPower);
            features.Add("rim");
        }

        if (!IsPlaceholder(values.Matcap))
        {
            material.SetInt("_UseMatCap", 1);
            material.SetTexture("_MatCapTex", values.Matcap);
            material.SetColor("_MatCapColor", values.MatcapColor);
            material.SetInt("_MatCapBlendMode", 1); // MToon adds the matcap.
            material.SetFloat("_MatCapBlend", 1f);
            material.SetFloat("_MatCapMainStrength", 0f);
            features.Add("matcap");
        }

        if (values.EmissionColor.maxColorComponent > 0f)
        {
            material.SetInt("_UseEmission", 1);
            material.SetColor("_EmissionColor", values.EmissionColor);
            material.SetTexture("_EmissionMap", IsPlaceholder(values.EmissionMap) ? null : values.EmissionMap);
            material.SetFloat("_EmissionBlend", 1f);
            features.Add("emission");
        }

        if (values.OutlineOn)
        {
            material.SetFloat("_OutlineWidth", values.OutlineWidth);
            material.SetColor("_OutlineColor", values.OutlineColor);
            material.SetTexture("_OutlineWidthMask", values.OutlineWidthTex);
            material.SetFloat("_OutlineEnableLighting", values.OutlineLit ? 1f : 0f);
            material.SetFloat("_OutlineFixWidth", 0.5f);
            features.Add("outline");
        }

        if (profile.CatboyPreset) ApplyNamedFeatures(material, source.name, features);

        material.renderQueue = source.renderQueue;
        var assetPath = $"{profile.MaterialFolder}/{SafeFileName(source.name)}.mat";
        // A new asset each run, so that no value from an earlier run stays in the file.
        AssetDatabase.DeleteAsset(assetPath);
        AssetDatabase.CreateAsset(material, assetPath);
        lines.Add($"{source.name} | {source.shader.name} -> {material.shader.name} | queue {material.renderQueue} | {string.Join(", ", features)}");
        return material;
    }

    // Catboy preset: extra slice features chosen by material name.
    private static void ApplyNamedFeatures(Material material, string name, List<string> features)
    {
        var isSkin = name.Contains("_SKIN");
        var isHair = name.Contains("_HAIR");
        // lilToon mixes the second and third band into the first shadow region only, so the borders
        // must nest below the mapped first border. The face has a first border near 0.15.
        var firstBorder = material.GetFloat("_ShadowBorder");
        if (isSkin)
        {
            material.SetColor("_Shadow2ndColor", new Color(0.85f, 0.62f, 0.68f, 1f));
            material.SetFloat("_Shadow2ndBorder", firstBorder * 0.75f);
            material.SetFloat("_Shadow2ndBlur", 0.02f);
            material.SetColor("_Shadow3rdColor", new Color(0.62f, 0.4f, 0.55f, 1f));
            material.SetFloat("_Shadow3rdBorder", firstBorder * 0.45f);
            material.SetFloat("_Shadow3rdBlur", 0.02f);
            features.Add("shadow2");
            features.Add("shadow3");

            material.SetInt("_UseBacklight", 1);
            material.SetColor("_BacklightColor", new Color(1f, 0.85f, 0.7f, 1f));
            material.SetFloat("_BacklightMainStrength", 0f);
            material.SetFloat("_BacklightBorder", 0.35f);
            material.SetFloat("_BacklightBlur", 0.05f);
            material.SetFloat("_BacklightDirectivity", 5f);
            material.SetFloat("_BacklightViewStrength", 1f);
            material.SetInt("_BacklightReceiveShadow", 1);
            features.Add("backlight");

            material.SetInt("_UseRim", 1);
            material.SetColor("_RimColor", new Color(0.9f, 0.7f, 0.7f, 1f));
            material.SetFloat("_RimBorder", 0.5f);
            material.SetFloat("_RimBlur", 0.3f);
            material.SetFloat("_RimFresnelPower", 3.5f);
            if (!features.Contains("rim")) features.Add("rim");

            // Shadow strength mask on the body only: its main texture varies, so its red channel scales
            // the shadow strength. The face keeps no shadow mask; a mask from the face outline width
            // texture pushes the skin around the eyes and the mouth into the second and third band.
            if (name.Contains("_Body_"))
            {
                material.SetTexture("_ShadowStrengthMask", material.GetTexture("_MainTex"));
                material.SetFloat("_ShadowStrength", 1f);
                features.Add("shadowStrengthMask");
            }
        }
        if (isHair)
        {
            material.SetColor("_Shadow2ndColor", new Color(0.6f, 0.55f, 0.8f, 1f));
            material.SetFloat("_Shadow2ndBorder", firstBorder * 0.75f);
            material.SetFloat("_Shadow2ndBlur", 0.02f);
            material.SetColor("_Shadow3rdColor", new Color(0.4f, 0.35f, 0.6f, 1f));
            material.SetFloat("_Shadow3rdBorder", firstBorder * 0.45f);
            material.SetFloat("_Shadow3rdBlur", 0.02f);
            features.Add("shadow2");
            features.Add("shadow3");

            material.SetInt("_UseRim", 1);
            material.SetColor("_RimColor", new Color(0.8f, 0.8f, 1f, 1f));
            material.SetFloat("_RimBorder", 0.5f);
            material.SetFloat("_RimBlur", 0.3f);
            material.SetFloat("_RimFresnelPower", 3.5f);
            if (!features.Contains("rim")) features.Add("rim");
            if (!features.Contains("matcap")) Debug.LogWarning($"{name}: the hair has no matcap texture in the source.");
        }
        // The source cat ears have a white shade, so a light does not shade them. The owner asked for a
        // neutral grey shade (not the blue cloth shade) at the brightness of the cloth shade.
        if (name.Contains("_CatEar_"))
        {
            material.SetColor("_ShadowColor", new Color(0.84f, 0.84f, 0.84f, 1f));
            features.Add("earShade");
        }
    }

    private static string ExpectedShaderName(RenderingMode mode, bool outline)
    {
        switch (mode)
        {
            case RenderingMode.Cutout: return outline ? "Hidden/lilToonCutoutOutline" : "Hidden/lilToonCutout";
            case RenderingMode.Transparent: return outline ? "Hidden/lilToonTransparentOutline" : "Hidden/lilToonTransparent";
            default: return outline ? "Hidden/lilToonOutline" : "lilToon";
        }
    }

    private sealed class MToonValues
    {
        public Color Color = Color.white;
        public Texture MainTex;
        public Vector2 MainScale = Vector2.one;
        public Vector2 MainOffset = Vector2.zero;
        public Color ShadeColor = Color.white;
        public Texture ShadeTex;
        public float ShadowBorder = 0.5f;
        public float ShadowBlur = 0.1f;
        public Texture BumpMap;
        public float BumpScale = 1f;
        public Color RimColor = Color.black;
        public float RimFresnelPower = 1f;
        public Texture Matcap;
        public Color MatcapColor = Color.white;
        public Color EmissionColor = Color.black;
        public Texture EmissionMap;
        public int AlphaMode; // 0 opaque, 1 cutout, 2 transparent
        public float Cutoff = 0.5f;
        public int Cull = 2;
        public bool OutlineOn;
        public float OutlineWidth; // lilToon units: the shader multiplies by 0.01
        public Color OutlineColor = Color.black;
        public Texture OutlineWidthTex;
        public bool OutlineLit;
    }

    private static MToonValues ReadMToon(Material m)
    {
        var v = new MToonValues();
        v.Color = GetColor(m, "_Color", Color.white);
        v.MainTex = GetTexture(m, "_MainTex");
        if (m.HasProperty("_MainTex"))
        {
            v.MainScale = m.GetTextureScale("_MainTex");
            v.MainOffset = m.GetTextureOffset("_MainTex");
        }
        v.ShadeColor = GetColor(m, "_ShadeColor", Color.white);
        v.BumpMap = GetTexture(m, "_BumpMap");
        v.BumpScale = GetFloat(m, "_BumpScale", 1f);
        v.RimColor = GetColor(m, "_RimColor", Color.black);
        v.RimFresnelPower = GetFloat(m, "_RimFresnelPower", 1f);
        v.EmissionColor = GetColor(m, "_EmissionColor", Color.black);
        v.EmissionMap = GetTexture(m, "_EmissionMap");
        v.Cutoff = GetFloat(m, "_Cutoff", 0.5f);
        v.Cull = (int)GetFloat(m, "_CullMode", 2f);
        v.OutlineColor = GetColor(m, "_OutlineColor", Color.black);
        v.OutlineLit = GetFloat(m, "_OutlineLightingMix", 1f) > 0.5f;
        var outlineMode = (int)GetFloat(m, "_OutlineWidthMode", 0f);

        if (m.shader.name.Contains("MToon10"))
        {
            // VRM 1.0 MToon: shading = linearstep(-1 + toony, 1 - toony, NdotL + shift).
            // lilToon bands on half-Lambert with a window of [border - blur / 2, border + blur / 2].
            var shift = GetFloat(m, "_ShadingShiftFactor", 0f);
            var toony = GetFloat(m, "_ShadingToonyFactor", 0.9f);
            v.ShadowBorder = Mathf.Clamp01(0.5f - 0.5f * shift);
            v.ShadowBlur = Mathf.Clamp01(1f - toony);
            v.ShadeTex = GetTexture(m, "_ShadeTex");
            v.Matcap = GetTexture(m, "_MatcapTex");
            v.MatcapColor = GetColor(m, "_MatcapColor", Color.white);
            v.AlphaMode = (int)GetFloat(m, "_AlphaMode", 0f);
            if (GetFloat(m, "_DoubleSided", 0f) > 0.5f) v.Cull = 0;
            // MToon10 stores the world outline width in meters; lilToon multiplies its width by 0.01.
            v.OutlineWidth = GetFloat(m, "_OutlineWidth", 0f) * 100f;
            v.OutlineWidthTex = GetTexture(m, "_OutlineWidthTex");
        }
        else
        {
            // VRM 0.x MToon: lit = saturate((NdotL - shift) / (lerp(1, shift, toony) - shift)).
            var shift = GetFloat(m, "_ShadeShift", 0f);
            var toony = GetFloat(m, "_ShadeToony", 0.9f);
            var min = shift * 0.5f + 0.5f;
            var max = Mathf.Lerp(1f, shift, toony) * 0.5f + 0.5f;
            v.ShadowBorder = Mathf.Clamp01((min + max) * 0.5f);
            v.ShadowBlur = Mathf.Clamp01(max - min);
            v.ShadeTex = GetTexture(m, "_ShadeTexture");
            v.Matcap = GetTexture(m, "_SphereAdd");
            var blend = (int)GetFloat(m, "_BlendMode", 0f);
            v.AlphaMode = blend == 1 ? 1 : blend >= 2 ? 2 : 0;
            // VRM 0.x stores the world outline width in centimeters, the same unit as lilToon.
            v.OutlineWidth = GetFloat(m, "_OutlineWidth", 0f);
            v.OutlineWidthTex = GetTexture(m, "_OutlineWidthTexture");
        }
        v.OutlineOn = outlineMode != 0 && v.OutlineWidth > 0f;
        return v;
    }

    private static float GetFloat(Material m, string name, float fallback) => m.HasProperty(name) ? m.GetFloat(name) : fallback;
    private static Color GetColor(Material m, string name, Color fallback) => m.HasProperty(name) ? m.GetColor(name) : fallback;
    private static Texture GetTexture(Material m, string name) => m.HasProperty(name) ? m.GetTexture(name) : null;

    // VRoid exports 1x1 "Shader_None*" textures where a slot is unused.
    private static bool IsPlaceholder(Texture t) => t == null || t.name.StartsWith("Shader_None") || (t.width <= 2 && t.height <= 2);

    private static string SafeFileName(string name)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        return name;
    }

    // The camera position and target. The catboy preset keeps the fixed rig of the recorded evidence;
    // the none preset looks at a point below the head bone, from the same distance.
    internal static (Vector3 Position, Vector3 Target) ReferenceRig(GameObject root, LilToonSampleProfile profile)
    {
        if (profile.CatboyPreset) return (CameraPosition, CameraTarget);
        var head = root.GetComponentInChildren<Animator>()?.GetBoneTransform(HumanBodyBones.Head);
        if (head == null) throw new InvalidOperationException($"{root.name} has no humanoid head bone to frame the camera.");
        var target = new Vector3(0f, head.position.y - HeadFrameDrop, 0f);
        return (target + new Vector3(0f, 0f, CameraPosition.z - CameraTarget.z), target);
    }

    // The flat ambient color. In the built-in pipeline, lilToon takes the indirect light from the SH probe on the axis of its
    // L1 term. A flat ambient has no L1 term, so that axis is not defined and lilToon reads an indirect light of about 1;
    // `_ShadowEnvStrength` then lights each shade. The none preset adds an L1 term of 0.001 on +Y, so lilToon reads the
    // ambient as MToon does. The catboy preset keeps the flat ambient of the recorded evidence.
    internal static void ApplyReferenceAmbient(LilToonSampleProfile profile)
    {
        RenderSettings.ambientMode = AmbientMode.Flat;
        RenderSettings.ambientLight = AmbientColor;
        if (profile.CatboyPreset) return;
        var probe = RenderSettings.ambientProbe;
        for (var channel = 0; channel < 3; channel++) probe[channel, 2] = 0.001f;
        RenderSettings.ambientMode = AmbientMode.Custom;
        RenderSettings.ambientProbe = probe;
    }

    // Also used by LilToonSampleExport.CaptureOriginal for the MToon capture.
    internal static Camera AddReferenceLightAndCamera((Vector3 Position, Vector3 Target) rig, LilToonSampleProfile profile)
    {
        var lightObject = new GameObject(LightName);
        var light = lightObject.AddComponent<Light>();
        light.type = LightType.Directional;
        light.color = Color.white;
        light.intensity = LightIntensity;
        light.shadows = LightShadows.None;
        lightObject.transform.rotation = Quaternion.Euler(LightRotation);

        ApplyReferenceAmbient(profile);
        RenderSettings.skybox = null;
        RenderSettings.sun = light;

        var cameraObject = new GameObject(CameraName);
        var camera = cameraObject.AddComponent<Camera>();
        cameraObject.transform.position = rig.Position;
        cameraObject.transform.LookAt(rig.Target);
        camera.fieldOfView = CameraFieldOfView;
        camera.nearClipPlane = 0.05f;
        camera.farClipPlane = 20f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = CameraBackground;
        camera.allowHDR = false;
        camera.allowMSAA = false;
        return camera;
    }
}
