using System.ComponentModel.DataAnnotations;

namespace Vistoria.Api.Infrastructure.Validation;

/// <summary>
/// CPF (11 dígitos) ou CNPJ (14 caracteres), sem máscara, com os dígitos verificadores conferidos. O CNPJ pode ser
/// alfanumérico (Receita Federal, desde julho de 2026): <c>A–Z</c> maiúsculo nas 12 primeiras posições e os dois
/// verificadores numéricos, cada caractere valendo o código ASCII menos 48. <c>null</c> passa (campo opcional);
/// <c>""</c> não.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class CpfCnpjAttribute : ValidationAttribute
{
    private static readonly int[] CpfWeights = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    private static readonly int[] CnpjWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    public CpfCnpjAttribute()
        : base("Informe um CPF ou CNPJ válido, sem pontuação.")
    {
    }

    public override bool IsValid(object? value) => value switch
    {
        null => true,
        string s => IsCpf(s) || IsCnpj(s),
        _ => false,
    };

    public static bool IsCpf(string value) =>
        value.Length == 11
        && value.All(char.IsAsciiDigit)
        && !AllSame(value)
        && CheckDigitsMatch(value, CpfWeights);

    public static bool IsCnpj(string value) =>
        value.Length == 14
        && value[..12].All(c => char.IsAsciiDigit(c) || char.IsAsciiLetterUpper(c))
        && value[12..].All(char.IsAsciiDigit)
        && !AllSame(value)
        && CheckDigitsMatch(value, CnpjWeights);

    // Módulo 11 nos dois verificadores: o primeiro sobre os n − 2 iniciais, o segundo incluindo o primeiro. Os
    // pesos do primeiro são os do segundo sem o mais à esquerda.
    private static bool CheckDigitsMatch(string value, int[] weights)
    {
        var body = value.Length - 2;
        for (var position = body; position < value.Length; position++)
        {
            var offset = weights.Length - position;
            var sum = 0;
            for (var i = 0; i < position; i++)
            {
                sum += (value[i] - '0') * weights[offset + i];
            }

            var remainder = sum % 11;
            if (value[position] - '0' != (remainder < 2 ? 0 : 11 - remainder))
            {
                return false;
            }
        }

        return true;
    }

    // 111.111.111-11 e afins passam no cálculo, mas não são documentos.
    private static bool AllSame(string value) => value.All(c => c == value[0]);
}
