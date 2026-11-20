using System.ComponentModel.DataAnnotations;

namespace Vistoria.Api.Infrastructure.Validation;

/// <summary>
/// Telefone brasileiro com DDD, que a API normaliza antes de validar e grava só com dígitos (ADR 0063): fixo com 10
/// (o número começa de 2 a 5) ou celular com 11 (o número começa por 9), num DDD que existe. A entrada pode vir com
/// máscara e com o <c>+55</c>: a fila de um aparelho de antes da regra os tem, e a API não os recusa. <c>null</c>
/// passa (campo opcional); <c>""</c> não.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class TelefoneAttribute : ValidationAttribute
{
    /// <summary>Os 67 DDDs do plano de numeração da Anatel.</summary>
    public static readonly IReadOnlySet<string> Ddds = new HashSet<string>(StringComparer.Ordinal)
    {
        "11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "24", "27", "28",
        "31", "32", "33", "34", "35", "37", "38", "41", "42", "43", "44", "45", "46", "47",
        "48", "49", "51", "53", "54", "55", "61", "62", "63", "64", "65", "66", "67", "68",
        "69", "71", "73", "74", "75", "77", "79", "81", "82", "83", "84", "85", "86", "87",
        "88", "89", "91", "92", "93", "94", "95", "96", "97", "98", "99",
    };

    private const string CountryCode = "55";

    public TelefoneAttribute()
        : base("Informe o telefone com DDD: 10 dígitos (fixo) ou 11 (celular).")
    {
    }

    public override bool IsValid(object? value) => value switch
    {
        null => true,
        string s => IsCanonical(Normalize(s)!),
        _ => false,
    };

    /// <summary>
    /// Só os dígitos, sem o <c>55</c> do país quando ele sobra (12 ou 13 dígitos: o canônico tem no máximo 11).
    /// O que não vira canônico sai assim mesmo, e a validação o recusa.
    /// </summary>
    public static string? Normalize(string? value)
    {
        if (value is null)
        {
            return null;
        }

        var digits = string.Concat(value.Where(char.IsAsciiDigit));
        return digits.Length is 12 or 13 && digits.StartsWith(CountryCode, StringComparison.Ordinal)
            ? digits[CountryCode.Length..]
            : digits;
    }

    /// <summary>DDD válido e o número de um fixo (10 dígitos, de 2 a 5) ou de um celular (11, começando por 9).</summary>
    public static bool IsCanonical(string value) =>
        value.All(char.IsAsciiDigit)
        && Ddds.Contains(value[..Math.Min(2, value.Length)])
        && value.Length switch
        {
            10 => value[2] is >= '2' and <= '5',
            11 => value[2] == '9',
            _ => false,
        };
}
